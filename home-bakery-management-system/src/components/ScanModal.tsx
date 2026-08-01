import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, Search, Check, Link as LinkIcon } from "lucide-react";
import Modal from "./ui/Modal";
import Badge from "./ui/Badge";
import {
  adjustInventoryQuantity,
  lookupInventoryByCode,
  updateInventoryItem,
  enrichBarcode,
  type ApiInventoryItem,
  type OffProduct,
} from "../utils/api";
import { useStore } from "../context/StoreContext";
import type { InventoryItem } from "../types";

type Mode = "scanning" | "adjust" | "bind" | "preview" | "conflict" | "error";

interface ConflictInfo { id: string; name: string }

export default function ScanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { inventory, refreshInventory } = useStore();
  const [mode, setMode] = useState<Mode>("scanning");
  const [code, setCode] = useState<string>("");
  const [item, setItem] = useState<ApiInventoryItem | null>(null);
  const [conflict, setConflict] = useState<ConflictInfo | null>(null);
  const [offProduct, setOffProduct] = useState<OffProduct | null>(null);
  const [newCount, setNewCount] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string>("");
  const [bindSearch, setBindSearch] = useState("");
  const [bindPick, setBindPick] = useState<InventoryItem | null>(null);

  // Manual-entry hidden input ref (used by the camera-disable fallback AND by the scanner gun)
  const manualRef = useRef<HTMLInputElement | null>(null);
  // Camera scanner lifecycle
  const scannerRef = useRef<any>(null);
  const scannerElId = "scan-modal-reader";
  const lastDecodedRef = useRef<{ code: string; ts: number } | null>(null);

  const focusManual = useCallback(() => {
    const t = window.setTimeout(() => manualRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, []);

  // Core handler: a barcode arrived (camera or gun/manual)
  const handleCode = useCallback(async (rawCode: string) => {
    const c = (rawCode || "").trim();
    if (!c) return;
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
        setItem(r.item);
        setNewCount(Number(r.item.quantity) || 0);
        setMode("adjust");
      } else {
        // 404 — offer to bind to an existing item
        setItem(null);
        setMode("bind");
        setBindPick(null);
        setBindSearch("");
      }
    } catch (e: any) {
      setErrMsg(e?.message || "Lookup failed");
      setMode("error");
    } finally {
      setBusy(false);
      focusManual();
    }
  }, [focusManual]);

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
    setErrMsg("");
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

  // After a code is bound (or skipped), look it up so the count stepper opens.
  const gotoAdjust = useCallback(async () => {
    const r = await lookupInventoryByCode(code);
    if ("item" in r) {
      setItem(r.item);
      setNewCount(Number(r.item.quantity) || 0);
      setMode("adjust");
      await refreshInventory();
    } else {
      throw new Error("Bind succeeded but lookup failed");
    }
  }, [code, refreshInventory]);

  const saveAdjust = useCallback(async () => {
    if (!item) return;
    setBusy(true);
    setErrMsg("");
    try {
      const current = Number(item.quantity) || 0;
      const delta = newCount - current;
      if (!Number.isFinite(delta)) throw new Error("Invalid count");
      const r = await adjustInventoryQuantity(item.id, delta);
      if ("error" in r) throw new Error(r.error);
      await refreshInventory();
      // Return to scanning so the next item can be scanned immediately
      setItem(null);
      setCode("");
      setMode("scanning");
      focusManual();
    } catch (e: any) {
      setErrMsg(e?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }, [item, newCount, refreshInventory, focusManual]);

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
    try {
      const patch: Record<string, any> = {
        nutrition_source: `off:${code}`,
        nutrition_fetched_at: new Date().toISOString(),
      };
      if (offProduct.brand) patch.supplier = offProduct.brand;
      if (offProduct.ingredients) patch.ingredients_label = offProduct.ingredients;
      if (offProduct.allergens.length) patch.allergens = offProduct.allergens;
      if (offProduct.unitWeightLb != null) patch.unit_weight = offProduct.unitWeightLb;
      await updateInventoryItem(bindPick.id, patch as any);
      await gotoAdjust();
    } catch (e: any) {
      setErrMsg(String(e?.message || "Apply failed"));
      setMode("error");
    } finally {
      setBusy(false);
    }
  }, [bindPick, offProduct, code, gotoAdjust]);

  const bindMatches = useMemo(() => {
    const q = bindSearch.trim().toLowerCase();
    if (!q) return inventory.slice(0, 20);
    return inventory
      .filter(i => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
      .slice(0, 30);
  }, [bindSearch, inventory]);

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

        {mode === "scanning" && (
          <div className="text-sm text-stone-500 flex items-center gap-2">
            <ScanLine className="w-4 h-4" /> Waiting for a code…
          </div>
        )}

        {mode === "adjust" && item && (
          <AdjustPanel
            item={item}
            newCount={newCount}
            setNewCount={setNewCount}
            onSave={saveAdjust}
            onCancel={() => { setItem(null); setMode("scanning"); focusManual(); }}
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

        {mode === "preview" && offProduct && (
          <div className="rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex items-start gap-3">
              {offProduct.imageUrl && (
                <img
                  src={offProduct.imageUrl}
                  alt="Open Food Facts product"
                  className="h-16 w-16 rounded-lg object-cover"
                />
              )}
              <div className="min-w-0">
                <div className="font-semibold text-stone-900">{offProduct.name}</div>
                <div className="text-xs text-stone-500">
                  {offProduct.brand}
                  {offProduct.brand && offProduct.quantity ? " · " : ""}
                  {offProduct.quantity}
                </div>
              </div>
            </div>
            {offProduct.ingredients && (
              <p className="mt-2 line-clamp-2 text-xs text-stone-600">{offProduct.ingredients}</p>
            )}
            {offProduct.allergens.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {offProduct.allergens.map((a) => (
                  <Badge key={a} tone="new">{a}</Badge>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-stone-400">
              Product data from Open Food Facts — review before using.
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() =>
                  gotoAdjust().catch((e: any) => {
                    setErrMsg(String(e?.message || "Skip failed"));
                    setMode("error");
                  })
                }
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
            Code <code className="font-mono">{code}</code> is already bound to <strong>{conflict.name}</strong> (<code>{conflict.id}</code>). Unbind it there first if you want to reassign.
          </div>
        )}
      </div>
    </Modal>
  );
}

function AdjustPanel({ item, newCount, setNewCount, onSave, onCancel, busy }: {
  item: ApiInventoryItem;
  newCount: number;
  setNewCount: (n: number) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const delta = newCount - (Number(item.quantity) || 0);
  const sign = delta === 0 ? "±" : delta > 0 ? "+" : "−";
  const deltaLabel = delta === 0 ? "no change" : `${sign}${Math.abs(delta)}`;
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-stone-900">{item.name}</div>
          <div className="text-xs text-stone-500 font-mono">{item.id}</div>
        </div>
        <Badge tone="stone">{item.category}</Badge>
      </div>
      <div className="mt-3 text-sm text-stone-600">
        Current on hand: <strong>{Number(item.quantity).toFixed(2)}</strong> {item.unit}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <label className="text-xs text-stone-500 block">New count</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={newCount}
            autoFocus
            onChange={e => setNewCount(Number(e.target.value))}
            className="w-full mt-1 rounded-lg border border-stone-300 px-3 py-2 text-lg font-semibold"
          />
        </div>
        <div className="text-xs text-stone-500 pb-2 w-24 text-right">{item.unit}<br/><span className="text-stone-400">delta {deltaLabel}</span></div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 rounded-lg text-stone-700 hover:bg-stone-100" disabled={busy}>Cancel</button>
        <button
          onClick={onSave}
          disabled={busy || newCount < 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-coral text-white hover:opacity-90 disabled:opacity-50"
        >
          <Check className="w-4 h-4" /> Save
        </button>
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
