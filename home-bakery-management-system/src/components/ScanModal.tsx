import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, Search, Check, Link as LinkIcon, CheckCircle2, Unlink, Plus, Sparkles } from "lucide-react";
import Modal from "./ui/Modal";
import Badge from "./ui/Badge";
import {
  adjustInventoryQuantity,
  lookupInventoryByCode,
  updateInventoryItem,
  enrichBarcode,
  createInventoryItem,
  createInventoryGroup,
  type ApiInventoryItem,
  type InventoryItemCreate,
  type OffProduct,
} from "../utils/api";
import { useStore } from "../context/StoreContext";
import { sanitizeBarcode } from "../utils/barcode";
import type { IngredientGroup, InventoryItem } from "../types";
import { GroupPicker, type GroupChoice } from "./GroupPicker";
import { useIngredientGroups } from "../hooks/useIngredientGroups";
import { isActiveMember } from "../utils/ingredientGroups";

type Mode = "scanning" | "adjust" | "bind" | "preview" | "conflict" | "error" | "suggestCreate" | "manualCreate";

interface ConflictInfo { id: string; name: string }

interface RecognizedInfo { sourceLabel: string | null; fetchedAt: string | null }

const COMMON_UNITS = ["each", "lb", "oz", "g", "kg", "fl oz", "L", "ml", "bag", "box", "case", "dozen"];

// An item is "recognized" when it's linked to a real (non-seeded) barcode and
// already carries name + ingredient/allergen info.
function computeRecognized(it: ApiInventoryItem): RecognizedInfo | null {
  const realBarcode = !!it.barcode && it.barcode !== it.id;
  if (!realBarcode) return null;
  if (!it.ingredients_label && !it.nutrition_source) return null;
  let sourceLabel: string | null = "your records";
  if (it.nutrition_source) {
    if (it.nutrition_source.startsWith("off:")) sourceLabel = "Open Food Facts";
    else if (it.nutrition_source.startsWith("fdc:")) sourceLabel = "USDA";
  }
  return { sourceLabel, fetchedAt: it.nutrition_fetched_at || null };
}

// Convert an API-shaped inventory row into the store shape with parsed
// allergens — needed so activateItem composes label fields correctly.
function apiItemToStoreShape(it: ApiInventoryItem): InventoryItem {
  let allergens: string[] = [];
  try {
    const p = JSON.parse(it.allergens || "[]");
    if (Array.isArray(p)) allergens = p;
  } catch { /* ignore */ }
  return {
    id: it.id,
    name: it.name,
    category: it.category,
    quantity: Number(it.quantity) || 0,
    unit: it.unit,
    reorderLevel: Number(it.reorder_level) || 0,
    costPerUnit: Number(it.cost_per_unit) || 0,
    supplier: it.supplier || "",
    ingredients_label: it.ingredients_label || undefined,
    allergens: allergens.length ? allergens : undefined,
    unit_weight: typeof it.unit_weight === "number" ? it.unit_weight : undefined,
    active: !!it.active,
    barcode: it.barcode || null,
  };
}

export default function ScanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { inventory, groups, refreshInventory } = useStore();
  const { activateItem } = useIngredientGroups();
  const [mode, setMode] = useState<Mode>("scanning");
  const [code, setCode] = useState<string>("");
  const [item, setItem] = useState<ApiInventoryItem | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [offProduct, setOffProduct] = useState<OffProduct | null>(null);
  const [recognized, setRecognized] = useState<RecognizedInfo | null>(null);
  const [countMode, setCountMode] = useState<"add" | "set">(() => {
    try { return localStorage.getItem("scan_count_mode") === "set" ? "set" : "add"; } catch { return "add"; }
  });
  const [countValue, setCountValue] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string>("");
  const [scanWarn, setScanWarn] = useState<string>("");
  const [bindSearch, setBindSearch] = useState("");
  const [bindPick, setBindPick] = useState<InventoryItem | null>(null);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Uncategorized");
  const [newUnit, setNewUnit] = useState("ea");
  const [groupChoice, setGroupChoice] = useState<GroupChoice>({ kind: "none" });
  const [makeActiveChecked, setMakeActiveChecked] = useState(false);
  const [swapMsg, setSwapMsg] = useState("");

  // Session-level trail of the last few scans (code + action) shown under the viewfinder.
  const [sessionScans, setSessionScans] = useState<{ code: string; action: string }[]>([]);

  // Manual-entry hidden input ref (used by the camera-disable fallback AND by the scanner gun)
  const manualRef = useRef<HTMLInputElement | null>(null);
  // Camera scanner lifecycle
  const scannerRef = useRef<any>(null);
  const scannerElId = "scan-modal-reader";
  const lastDecodedRef = useRef<{ code: string; ts: number } | null>(null);
  const modeRef = useRef<Mode>("scanning");
  const countModeRef = useRef<"add" | "set">(countMode);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { countModeRef.current = countMode; }, [countMode]);

  const focusManual = useCallback(() => {
    const t = window.setTimeout(() => manualRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, []);

  const enterAdjustForItem = useCallback((it: ApiInventoryItem) => {
    setSwapMsg("");
    setItem(it);
    setCountValue(countModeRef.current === "set" ? (Number(it.quantity) || 0) : 0);
    setRecognized(computeRecognized(it));
    setMode("adjust");
  }, []);

  // Core handler: a barcode arrived (camera or gun/manual). Codes are ignored
  // unless we're in "scanning" mode, so camera re-reads can't wipe an open flow.
  const handleCode = useCallback(async (rawCode: string) => {
    const s = sanitizeBarcode(rawCode);
    // Internal codes (inv_*, mr…, short supplier codes) have no GTIN digits —
    // fall back to the stripped raw string so they keep working.
    const c = s.code || s.stripped.trim();
    if (!c) return;
    if (modeRef.current !== "scanning") return;
    // Warn (never block) when the code looks like a GTIN but fails its check digit.
    if (s.digits.length >= 8 && !s.valid) {
      setScanWarn("Scanned code fails its check digit — it may have been misread. Verify it before continuing.");
    } else {
      setScanWarn("");
    }
    // Debounce: ignore the same code within 1.2s (cameras can fire many reads)
    const last = lastDecodedRef.current;
    const now = Date.now();
    if (last && last.code === c && now - last.ts < 1200) return;
    lastDecodedRef.current = { code: c, ts: now };

    setCode(c);
    setErrMsg("");
    setBusy(true);
    try {
      const r = await lookupInventoryByCode(c);
      if ("item" in r) {
        setSessionScans(prev => [...prev.slice(-4), { code: c, action: "found" }]);
        enterAdjustForItem(r.item);
      } else {
        setSessionScans(prev => [...prev.slice(-4), { code: c, action: "new" }]);
        // 404 — unknown code. Try to recognize the product (Open Food Facts)
        // so we can suggest adding it as a brand-new inventory item.
        setItem(null);
        setRecognized(null);
        setBindPick(null);
        setBindSearch("");
        setGroupChoice({ kind: "none" });
        setMakeActiveChecked(false);
        let product: OffProduct | null = null;
        try {
          const er = await enrichBarcode(c);
          product = er && er.product ? er.product : null;
        } catch {
          product = null;
        }
        if (product) {
          setOffProduct(product);
          setNewName(product.name || "");
          setNewCategory("Uncategorized");
          setNewUnit(product.unitWeightLb != null ? "lb" : "ea");
          setMode("suggestCreate");
        } else {
          setOffProduct(null);
          setNewName("");
          setNewCategory("Uncategorized");
          setNewUnit("ea");
          setMode("manualCreate");
        }
      }
    } catch (e: any) {
      setErrMsg(e?.message || "Lookup failed");
      setMode("error");
    } finally {
      setBusy(false);
      focusManual();
    }
  }, [enterAdjustForItem, focusManual]);

  // Listen for the gun (HID-keyboard wedge typing code + Enter)
  const handleManualKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = (e.currentTarget.value || "").trim();
      e.currentTarget.value = "";
      if (v) handleCode(v);
    }
  }, [handleCode]);

  // Camera lifecycle
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMode("scanning");
    setCode("");
    setItem(null);
    setConflict(null);
    setOffProduct(null);
    setRecognized(null);
    setErrMsg("");
    setScanWarn("");
    setSessionScans([]);
    setGroupChoice({ kind: "none" });
    setMakeActiveChecked(false);
    setSwapMsg("");
    lastDecodedRef.current = null;

    (async () => {
      try {
        // Lazy-import so the library is split out of the initial admin bundle
        const { Html5Qrcode } = await import("html5-qrcode");
        if (cancelled || !document.getElementById(scannerElId)) return;
        const s = new Html5Qrcode(scannerElId, /* verbose */ false);
        scannerRef.current = s;
        await s.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: (vw: number, vh: number) => ({ width: Math.floor(vw * 0.85), height: Math.floor(vh * 0.45) }), aspectRatio: 1.777778, disableFlip: false },
          (decodedText: string) => handleCode(decodedText),
          () => { /* per-frame failure, ignore */ }
        );
        focusManual();
      } catch (e: any) {
        // Camera unavailable or denied — stay open with manual-entry fallback
        if (!cancelled) {
          setErrMsg("Camera unavailable — type a code and press Enter.");
          focusManual();
        }
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop().catch(() => {}).finally(() => {
          try { s.clear(); } catch {}
        });
        scannerRef.current = null;
      }
    };
  }, [open, handleCode, focusManual]);

  // Stop camera when modal closes
  useEffect(() => {
    if (!open && scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
  }, [open]);

  // After a code is bound (or skipped, or a new item created), look it up so the count stepper opens.
  const gotoAdjust = useCallback(async () => {
    const r = await lookupInventoryByCode(code);
    if ("item" in r) {
      enterAdjustForItem(r.item);
      await refreshInventory();
    } else {
      throw new Error("Item saved but re-lookup failed");
    }
  }, [code, enterAdjustForItem, refreshInventory]);

  const saveAdjust = useCallback(async () => {
    if (!item) return;
    setBusy(true);
    setErrMsg("");
    try {
      const current = Number(item.quantity) || 0;
      // "Add to current" = the typed value is a delta; "Set total" = absolute count.
      const delta = countModeRef.current === "add" ? countValue : countValue - current;
      if (!Number.isFinite(delta)) throw new Error("Invalid count");
      const r = await adjustInventoryQuantity(item.id, delta);
      if ("error" in r) throw new Error(r.error);
      await refreshInventory();
      // Return to scanning so the next item can be scanned immediately
      setSessionScans(prev => [...prev.slice(-4), { code: code, action: `adjusted ${delta > 0 ? "+" : ""}${delta}` }]);
      setItem(null);
      setCode("");
      setRecognized(null);
      setCountValue(0);
      setMode("scanning");
      focusManual();
    } catch (e: any) {
      setErrMsg(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }, [item, code, countValue, refreshInventory, focusManual]);

  const switchCountMode = useCallback((m: "add" | "set") => {
    setCountMode(m);
    try { localStorage.setItem("scan_count_mode", m); } catch {}
    setCountValue(m === "set" ? (Number(item?.quantity) || 0) : 0);
  }, [item]);

  const bindToItem = useCallback(async () => {
    if (!bindPick) return;
    setBusy(true);
    setErrMsg("");
    try {
      await updateInventoryItem(bindPick.id, { barcode: code } as any);
      // Auto-lookup the code on Open Food Facts (non-fatal if it fails or misses)
      let product: OffProduct | null = null;
      try {
        const r = await enrichBarcode(code);
        product = r && r.product ? r.product : null;
      } catch {
        product = null;
      }
      if (product) {
        setOffProduct(product);
        setMode("preview");
      } else {
        await gotoAdjust();
      }
    } catch (e: any) {
      // 409 conflict: another item already has this code
      const status = e?.status ?? 0;
      const body = e?.body ?? null;
      if (status === 409 || body?.code === 'barcode_conflict') {
        const c: ConflictInfo | null = body?.conflict ? { id: body.conflict.id, name: body.conflict.name } : null;
        if (c) {
          setConflict(c);
          setMode("conflict");
        } else {
          setErrMsg("Barcode already bound to another item.");
          setMode("error");
        }
      } else {
        setErrMsg(String(e?.message || "Bind failed"));
        setMode("error");
      }
    } finally {
      setBusy(false);
    }
  }, [bindPick, code, gotoAdjust]);

  // "Use this info" — apply the OFF fields to the bound item, then open the count stepper.
  const applyOff = useCallback(async () => {
    if (!bindPick || !offProduct) return;
    setBusy(true);
    setErrMsg("");
    const patch: Record<string, any> = {
      nutrition_source: `off:${code}`,
      nutrition_fetched_at: new Date().toISOString(),
    };
    if (offProduct.brand) patch.supplier = offProduct.brand;
    if (offProduct.ingredients) patch.ingredients_label = offProduct.ingredients;
    if (offProduct.allergens.length) patch.allergens = offProduct.allergens;
    if (offProduct.unitWeightLb != null) patch.unit_weight = offProduct.unitWeightLb;
    try {
      await updateInventoryItem(bindPick.id, patch as any);
    } catch (e: any) {
      // The save itself failed — "Apply failed" is honest here.
      setErrMsg(String(e?.message || "Apply failed"));
      setMode("error");
      setBusy(false);
      return;
    }
    try {
      await gotoAdjust();
    } catch (e: any) {
      // Data WAS saved; only the follow-up lookup failed.
      setErrMsg(String(e?.message || "Item saved but re-lookup failed"));
      setMode("error");
    } finally {
      setBusy(false);
    }
  }, [bindPick, offProduct, code, gotoAdjust]);

  // Create a brand-new inventory item from the scanned code (+ OFF data when available).
  const createNewItem = useCallback(async () => {
    const nm = newName.trim();
    if (!nm) return;
    setBusy(true);
    setErrMsg("");
    const payload: InventoryItemCreate = {
      id: `inv_${Date.now().toString(36)}`,
      name: nm,
      category: newCategory.trim() || "Uncategorized",
      unit: newUnit.trim() || "ea",
      quantity: 0,
      barcode: code,
    };
    if (offProduct) {
      payload.nutrition_source = `off:${code}`;
      payload.nutrition_fetched_at = new Date().toISOString();
      if (offProduct.brand) payload.supplier = offProduct.brand;
      if (offProduct.ingredients) payload.ingredients_label = offProduct.ingredients;
      if (offProduct.allergens.length) payload.allergens = offProduct.allergens;
      if (offProduct.unitWeightLb != null) payload.unit_weight = offProduct.unitWeightLb;
    }
    try {
      let groupId: string | null = null;
      if (groupChoice.kind === "existing") {
        groupId = groupChoice.id;
      } else if (groupChoice.kind === "new" && groupChoice.name.trim()) {
        const g = await createInventoryGroup({
          name: groupChoice.name.trim(),
          category: newCategory.trim() || null,
          active_item_id: makeActiveChecked ? payload.id : null,
        });
        groupId = g.id;
      }
      if (groupId) payload.group_id = groupId;

      await createInventoryItem(payload);
      await refreshInventory();

      if (groupChoice.kind === "existing" && groupId && makeActiveChecked) {
        const grp = groups.find((g) => g.id === groupId);
        if (grp) {
          // Full store-shaped item (label fields included) so the hook can
          // re-compose affected products' labels correctly.
          const fullItem: InventoryItem = {
            id: payload.id,
            name: nm,
            category: payload.category,
            quantity: payload.quantity ?? 0,
            unit: payload.unit,
            reorderLevel: payload.reorder_level ?? 0,
            costPerUnit: payload.cost_per_unit ?? 0,
            supplier: payload.supplier || "",
            ingredients_label: payload.ingredients_label,
            allergens: Array.isArray(payload.allergens) ? payload.allergens : undefined,
            unit_weight: payload.unit_weight ?? undefined,
            barcode: payload.barcode || null,
          };
          // Guard: activating a label-less item would silently drop it from
          // the affected products' stored labels — declining skips only the
          // activation (the item is already saved above).
          const hasLabelData = !!(payload.ingredients_label || (Array.isArray(payload.allergens) && payload.allergens.length));
          if (hasLabelData || window.confirm("This item has no label data yet. Products that auto-generate labels will not include it until label data is added. Activate anyway?")) {
            const r = await activateItem(grp, fullItem);
            setSwapMsg(r.message);
          }
        }
      }
    } catch (e: any) {
      const status = e?.status ?? 0;
      const body = e?.body ?? null;
      if (status === 409 || body?.code === 'barcode_conflict') {
        const c: ConflictInfo | null = body?.conflict ? { id: body.conflict.id, name: body.conflict.name } : null;
        if (c) {
          setConflict(c);
          setMode("conflict");
        } else {
          setErrMsg("Barcode already bound to another item.");
          setMode("error");
        }
      } else {
        setErrMsg(String(e?.message || "Add failed"));
        setMode("error");
      }
      setBusy(false);
      return;
    }
    try {
      await gotoAdjust();
    } catch (e: any) {
      // Data WAS saved; only the follow-up lookup failed.
      setErrMsg(String(e?.message || "Item added but re-lookup failed"));
      setMode("error");
    } finally {
      setBusy(false);
    }
  }, [newName, newCategory, newUnit, offProduct, code, groupChoice, makeActiveChecked, groups, activateItem, gotoAdjust, refreshInventory]);

  // Clear the barcode from the item currently in the count stepper.
  const unbindCurrent = useCallback(async () => {
    if (!item) return;
    if (!window.confirm(`Remove barcode "${item.barcode}" from "${item.name}"? The item stays in inventory — you can scan and bind a new code anytime.`)) return;
    setBusy(true);
    setErrMsg("");
    try {
      await updateInventoryItem(item.id, { barcode: null } as any);
      await refreshInventory();
      setItem(null);
      setCode("");
      setRecognized(null);
      setMode("scanning");
      focusManual();
    } catch (e: any) {
      setErrMsg(String(e?.message || "Unbind failed"));
      setMode("error");
    } finally {
      setBusy(false);
    }
  }, [item, refreshInventory, focusManual]);

  // Swap a scanned (non-active) member in as the group's active ingredient.
  // Pass the STORE-shaped item (with label fields) so the hook can re-compose
  // the affected products' labels correctly.
  const swapToItem = useCallback(async (group: IngredientGroup, it: ApiInventoryItem) => {
    setBusy(true);
    setErrMsg("");
    try {
      const fullItem = inventory.find((x) => x.id === it.id) ?? apiItemToStoreShape(it);
      // Guard: activating a label-less item would silently drop it from the
      // affected products' stored labels — warn and let the user back out.
      const hasLabelData = !!(fullItem.ingredients_label || (fullItem.allergens && fullItem.allergens.length));
      if (!hasLabelData) {
        if (!window.confirm("This item has no label data yet. Products that auto-generate labels will not include it until label data is added. Activate anyway?")) return;
      }
      const r = await activateItem(group, fullItem);
      setSwapMsg(r.message);
    } catch (e: any) {
      setErrMsg(String(e?.message || "Switch failed"));
    } finally {
      setBusy(false);
    }
  }, [activateItem, inventory, apiItemToStoreShape]);

  // 409 conflict: free the code from the item that owns it, then retry the pending action.
  const unbindConflictAndRebind = useCallback(async () => {
    if (!conflict) return;
    setBusy(true);
    setErrMsg("");
    try {
      await updateInventoryItem(conflict.id, { barcode: null } as any);
      setConflict(null);
      if (bindPick) {
        await bindToItem();
      } else {
        await createNewItem();
      }
    } catch (e: any) {
      setErrMsg(String(e?.message || "Unbind failed"));
      setMode("error");
    } finally {
      setBusy(false);
    }
  }, [conflict, bindPick, bindToItem, createNewItem]);

  const bindMatches = useMemo(() => {
    const q = bindSearch.trim().toLowerCase();
    if (!q) return inventory.slice(0, 20);
    return inventory
      .filter(i => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
      .slice(0, 30);
  }, [bindSearch, inventory]);

  const categories = useMemo(
    () => [...new Set(inventory.map((i) => i.category).filter(Boolean))].sort(),
    [inventory]
  );

  return (
    <Modal open={open} onClose={onClose} title="Scan inventory" wide>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-stone-600">
          Point your phone camera at a barcode — or use a USB/Bluetooth scanner gun to type the code and press Enter.
        </p>

        {/* Camera viewfinder (always mounted while modal is open; library manages the video element) */}
        <div
          id={scannerElId}
          className="rounded-xl overflow-hidden bg-stone-900 min-h-[220px] max-h-[55vh]"
          aria-label="Barcode scanner viewfinder"
        />

        {/* Visually-hidden manual entry — used as the gun target and as a fallback when the camera is denied */}
        <label className="text-xs text-stone-500">
          Type or scan a code:
          <input
            ref={manualRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Manual barcode entry"
            onKeyDown={handleManualKey}
            className="sr-only"
            placeholder="…"
          />
          <span className="ml-2 text-stone-400">(focus moves here after every action)</span>
        </label>

        {busy && <div className="text-sm text-stone-500">Working…</div>}
        {errMsg && mode === "error" && (
          <div className="rounded-lg bg-red-50 text-red-800 px-3 py-2 text-sm">{errMsg}</div>
        )}
        {scanWarn && (
          <div className="rounded-lg bg-amber-50 text-amber-900 px-3 py-2 text-sm">{scanWarn}</div>
        )}
        {sessionScans.length > 0 && (
          <div className="flex items-center gap-2 text-[11px] text-stone-500">
            <span className="shrink-0">Recent scans:</span>
            <div className="flex flex-wrap gap-1.5">
              {sessionScans.slice(-5).reverse().map((sc, i) => (
                <span key={`${sc.code}-${i}`} className="rounded bg-stone-100 px-1.5 py-0.5 font-mono">
                  {sc.code.slice(0, 10)} · {sc.action}
                </span>
              ))}
            </div>
          </div>
        )}

        {mode === "scanning" && (
          <div className="text-sm text-stone-500 flex items-center gap-2">
            <ScanLine className="w-4 h-4" /> Waiting for a code…
          </div>
        )}

        {mode === "adjust" && item && (
          <AdjustPanel
            item={item}
            group={item.group_id ? groups.find((g) => g.id === item.group_id) || null : null}
            swapMsg={swapMsg}
            onSwap={swapToItem}
            recognized={recognized}
            countMode={countMode}
            countValue={countValue}
            setCountValue={setCountValue}
            onSwitchMode={switchCountMode}
            onSave={saveAdjust}
            onCancel={() => { setItem(null); setRecognized(null); setMode("scanning"); focusManual(); }}
            onUnbind={unbindCurrent}
            busy={busy}
          />
        )}

        {mode === "bind" && (
          <BindPanel
            code={code}
            search={bindSearch}
            setSearch={setBindSearch}
            matches={bindMatches}
            pick={bindPick}
            setPick={setBindPick}
            onBind={bindToItem}
            onCancel={() => { setMode("scanning"); focusManual(); }}
            busy={busy}
          />
        )}

        {(mode === "suggestCreate" || mode === "manualCreate") && (
          <NewItemPanel
            code={code}
            offProduct={mode === "suggestCreate" ? offProduct : null}
            name={newName}
            setName={setNewName}
            category={newCategory}
            setCategory={setNewCategory}
            unit={newUnit}
            setUnit={setNewUnit}
            categories={categories}
            groups={groups}
            groupChoice={groupChoice}
            setGroupChoice={setGroupChoice}
            makeActive={makeActiveChecked}
            setMakeActive={setMakeActiveChecked}
            onAdd={createNewItem}
            onBind={() => { setMode("bind"); setBindPick(null); setBindSearch(""); }}
            onCancel={() => { setMode("scanning"); focusManual(); }}
            busy={busy}
          />
        )}

        {mode === "preview" && offProduct && (
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <OffCard product={offProduct} />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  if (busy) return;
                  setBusy(true);
                  gotoAdjust()
                    .catch((e: any) => {
                      setErrMsg(String(e?.message || "Skip failed"));
                      setMode("error");
                    })
                    .finally(() => setBusy(false));
                }}
                disabled={busy}
                className="rounded-lg px-3 py-2 text-stone-700 hover:bg-stone-100"
              >
                Skip
              </button>
              <button
                onClick={applyOff}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-coral px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
              >
                <Check className="h-4 w-4" /> Use this info
              </button>
            </div>
          </div>
        )}

        {mode === "conflict" && conflict && (
          <div className="rounded-lg bg-amber-50 text-amber-900 px-3 py-2 text-sm">
            <p>
              Code <code className="font-mono">{code}</code> is already bound to <strong>{conflict.name}</strong> (<code>{conflict.id}</code>).
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                onClick={unbindConflictAndRebind}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                <Unlink className="w-3.5 h-3.5" /> Unbind it &amp; reassign here
              </button>
              <button
                onClick={() => { setMode("scanning"); focusManual(); }}
                disabled={busy}
                className="rounded-lg px-3 py-1.5 text-xs text-amber-900 hover:bg-amber-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function AdjustPanel({ item, group, swapMsg, onSwap, recognized, countMode, countValue, setCountValue, onSwitchMode, onSave, onCancel, onUnbind, busy }: {
  item: ApiInventoryItem;
  group: IngredientGroup | null;
  swapMsg: string;
  onSwap: (group: IngredientGroup, item: ApiInventoryItem) => void;
  recognized: RecognizedInfo | null;
  countMode: "add" | "set";
  countValue: number;
  setCountValue: (n: number) => void;
  onSwitchMode: (m: "add" | "set") => void;
  onSave: () => void;
  onCancel: () => void;
  onUnbind: () => void;
  busy: boolean;
}) {
  const active = group ? isActiveMember(apiItemToStoreShape(item), group) : false;
  const activeName = group ? group.members.find((m) => m.id === group.activeItemId)?.name : "";
  const current = Number(item.quantity) || 0;
  const delta = countMode === "add" ? countValue : countValue - current;
  const newTotal = current + delta;
  const deltaLabel = delta === 0 ? "no change" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`;
  const canUnbind = !!item.barcode && item.barcode !== item.id;
  const totalInvalid = !Number.isFinite(countValue) || newTotal < 0;
  const reorderLevel = Number(item.reorder_level) || 0;
  const outOfStock = reorderLevel > 0 && newTotal <= 0;
  const willBeLow = reorderLevel > 0 && newTotal > 0 && newTotal <= reorderLevel;
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-stone-900">{item.name}</div>
          <div className="text-xs text-stone-500 font-mono">{item.id}</div>
        </div>
        <Badge tone="stone">{item.category}</Badge>
      </div>

      {group && active && (
        <div className="mt-3 rounded-lg border border-palm/30 bg-palm/5 px-3 py-2 text-sm text-stone-700">
          <CheckCircle2 className="mr-1.5 inline h-4 w-4 text-palm" />
          Active for <strong>{group.name}</strong>
          {group.usedBy.length ? ` · used in ${group.usedBy.join(", ")}` : ""}.
        </div>
      )}
      {group && !active && (
        <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>
            <strong>{group.name}</strong> currently uses{" "}
            <strong>{activeName || "no active item"}</strong>. Use <strong>{item.name}</strong> for every
            product in this group instead?
          </p>
          <button
            onClick={() => onSwap(group, item)}
            disabled={busy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" /> Switch to {item.name}
          </button>
        </div>
      )}
      {swapMsg && (
        <div className="mt-3 rounded-lg border border-palm/30 bg-palm/5 px-3 py-2 text-sm text-palm">{swapMsg}</div>
      )}

      {outOfStock && (
        <div className="mt-3 rounded-lg border border-hibiscus-light/40 bg-hibiscus-light/10 px-3 py-2 text-sm text-hibiscus">
          Out of stock at {newTotal.toFixed(2)} {item.unit} — reorder now.
        </div>
      )}
      {willBeLow && (
        <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          After this you'll be at {newTotal.toFixed(2)} {item.unit} — below the reorder level of {reorderLevel} {item.unit}. Restock soon.
        </div>
      )}

      {recognized && (
        <div className="mt-3 rounded-lg border border-palm/30 bg-palm/5 p-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-stone-900">
            <CheckCircle2 className="w-4 h-4 text-palm" /> Item recognized
          </div>
          <p className="mt-0.5 text-xs text-stone-600">
            Linked to barcode <code className="font-mono">{item.barcode}</code> with name, ingredients &amp; allergen info loaded{recognized.sourceLabel ? ` from ${recognized.sourceLabel}` : ""}{recognized.fetchedAt ? ` on ${recognized.fetchedAt.slice(0, 10)}` : ""}. Just set the new count below.
          </p>
        </div>
      )}

      <div className="mt-3 text-sm text-stone-600">
        Current on hand: <strong>{current.toFixed(2)}</strong> {item.unit}
      </div>

      <div className="mt-3 inline-flex rounded-lg border border-stone-200 p-0.5 text-xs font-medium">
        <button
          onClick={() => onSwitchMode("add")}
          disabled={busy}
          className={`rounded-md px-3 py-1.5 transition ${countMode === "add" ? "bg-coral text-white" : "text-stone-600 hover:bg-stone-50"}`}
        >
          Add to current
        </button>
        <button
          onClick={() => onSwitchMode("set")}
          disabled={busy}
          className={`rounded-md px-3 py-1.5 transition ${countMode === "set" ? "bg-coral text-white" : "text-stone-600 hover:bg-stone-50"}`}
        >
          Set total
        </button>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs text-stone-500 block">
            {countMode === "add" ? "Amount to add" : "New total count"}
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={countValue}
            autoFocus
            onChange={e => setCountValue(Number(e.target.value))}
            className="w-full mt-1 rounded-lg border border-stone-300 px-3 py-2 text-lg font-semibold"
          />
        </div>
        <div className="text-xs text-stone-500 pb-2 w-28 text-right">
          {item.unit}
          <br />
          <span className="text-stone-400">
            delta {deltaLabel}
            <br />
            new total {newTotal.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        {canUnbind ? (
          <button
            onClick={onUnbind}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-stone-500 hover:bg-hibiscus-light/10 hover:text-hibiscus"
          >
            <Unlink className="w-3.5 h-3.5" /> Unbind barcode
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-lg text-stone-700 hover:bg-stone-100" disabled={busy}>Cancel</button>
          <button
            onClick={onSave}
            disabled={busy || totalInvalid}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-coral text-white hover:opacity-90 disabled:opacity-50"
          >
            <Check className="w-4 h-4" /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function BindPanel({ code, search, setSearch, matches, pick, setPick, onBind, onCancel, busy }: {
  code: string;
  search: string;
  setSearch: (s: string) => void;
  matches: InventoryItem[];
  pick: InventoryItem | null;
  setPick: (i: InventoryItem | null) => void;
  onBind: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2 text-sm text-amber-900">
        <LinkIcon className="w-4 h-4" />
        Code <code className="font-mono">{code}</code> isn't bound to any item yet. Pick the item it should map to:
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Search className="w-4 h-4 text-stone-500" />
        <input
          autoFocus
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or id…"
          className="flex-1 rounded-lg border border-stone-300 px-3 py-2"
        />
      </div>
      <ul className="mt-2 max-h-56 overflow-y-auto divide-y divide-stone-100 rounded-lg border border-stone-200">
        {matches.map(i => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => setPick(i)}
              className={`w-full text-left px-3 py-2 hover:bg-stone-50 flex items-center justify-between ${pick?.id === i.id ? "bg-coral/10" : ""}`}
            >
              <div>
                <div className="text-sm font-medium text-stone-900">{i.name}</div>
                <div className="text-xs text-stone-500 font-mono">{i.id}</div>
              </div>
              {pick?.id === i.id && <Check className="w-4 h-4 text-coral" />}
            </button>
          </li>
        ))}
        {!matches.length && <li className="px-3 py-2 text-sm text-stone-500">No matches.</li>}
      </ul>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 rounded-lg text-stone-700 hover:bg-stone-100" disabled={busy}>Cancel</button>
        <button
          onClick={onBind}
          disabled={busy || !pick}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-coral text-white hover:opacity-90 disabled:opacity-50"
        >
          <LinkIcon className="w-4 h-4" /> Bind
        </button>
      </div>
    </div>
  );
}

function NewItemPanel({ code, offProduct, name, setName, category, setCategory, unit, setUnit, categories, groups, groupChoice, setGroupChoice, makeActive, setMakeActive, onAdd, onBind, onCancel, busy }: {
  code: string;
  offProduct: OffProduct | null;
  name: string;
  setName: (s: string) => void;
  category: string;
  setCategory: (s: string) => void;
  unit: string;
  setUnit: (s: string) => void;
  categories: string[];
  groups: IngredientGroup[];
  groupChoice: GroupChoice;
  setGroupChoice: (c: GroupChoice) => void;
  makeActive: boolean;
  setMakeActive: (b: boolean) => void;
  onAdd: () => void;
  onBind: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      {offProduct ? (
        <>
          <div className="flex items-center gap-2 text-sm text-stone-700">
            <Sparkles className="w-4 h-4 text-palm shrink-0" />
            <span>
              Found <strong className="text-stone-900">{offProduct.name}</strong> for code{" "}
              <code className="font-mono">{code}</code> — add it as a new inventory item?
            </span>
          </div>
          <OffCard product={offProduct} />
        </>
      ) : (
        <div className="flex items-center gap-2 text-sm text-stone-700">
          <ScanLine className="w-4 h-4 text-stone-500 shrink-0" />
          <span>
            No product info found for code <code className="font-mono">{code}</code> — add it manually:
          </span>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <Field label="Item name">
          <input
            autoFocus
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. King Arthur All-Purpose Flour"
            className="w-full rounded-lg border border-stone-300 px-3 py-2"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <input
              list="scan-categories"
              type="text"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2"
            />
            <datalist id="scan-categories">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="Unit">
            <input
              list="scan-units"
              type="text"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2"
            />
            <datalist id="scan-units">
              {COMMON_UNITS.map(u => <option key={u} value={u} />)}
            </datalist>
          </Field>
        </div>
        <GroupPicker
          groups={groups}
          choice={groupChoice}
          setChoice={setGroupChoice}
          makeActive={makeActive}
          setMakeActive={setMakeActive}
          canMakeActive={
            groupChoice.kind === "new" ||
            (groupChoice.kind === "existing" &&
              !(groups.find((g) => g.id === groupChoice.id)?.activeItemId))
          }
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={onBind}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-100"
        >
          <LinkIcon className="w-4 h-4" /> Bind to existing item
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-100">Cancel</button>
          <button
            onClick={onAdd}
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-coral px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add to inventory
          </button>
        </div>
      </div>
    </div>
  );
}

function OffCard({ product }: { product: OffProduct }) {
  return (
    <div className="mt-3 rounded-lg border border-stone-100 bg-stone-50 p-3">
      <div className="flex items-start gap-3">
        {product.imageUrl && (
          <img
            src={product.imageUrl}
            alt="Open Food Facts product"
            className="h-16 w-16 rounded-lg object-cover"
          />
        )}
        <div className="min-w-0">
          <div className="font-semibold text-stone-900">{product.name}</div>
          <div className="text-xs text-stone-500">
            {product.brand}
            {product.brand && product.quantity ? " · " : ""}
            {product.quantity}
          </div>
        </div>
      </div>
      {product.ingredients && (
        <p className="mt-2 line-clamp-2 text-xs text-stone-600">{product.ingredients}</p>
      )}
      {product.allergens.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {product.allergens.map((a) => (
            <Badge key={a} tone="new">{a}</Badge>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-stone-400">
        Product data from Open Food Facts — review before using.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-stone-500">{label}</label>
      {children}
    </div>
  );
}
