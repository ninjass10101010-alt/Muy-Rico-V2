import { useState, useRef, Suspense, lazy } from "react";
import { History, Minus, Pencil, Plus, ScanLine, Search, Trash2, Unlink } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import Badge from "../components/ui/Badge";
import { formatCurrency } from "../utils/format";
import { fetchScanHistory, lookupUsdaIngredient, type ScanEvent, type UsdaCandidate } from "../utils/api";
import type { InventoryItem } from "../types";

const ScanModal = lazy(() => import("../components/ScanModal"));

const emptyItem = (): InventoryItem => ({
  id: "",
  name: "",
  category: "Dry Goods",
  quantity: 0,
  unit: "each",
  reorderLevel: 5,
  costPerUnit: 0,
  supplier: "",
  barcode: "",
});

export default function Inventory({ search }: { search: string }) {
  const { inventory, products, apiCreateInventoryItem, apiUpdateInventoryItem, apiDeleteInventoryItem } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [draft, setDraft] = useState<InventoryItem>(emptyItem());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [allergensText, setAllergensText] = useState("");
  const [usdaOpen, setUsdaOpen] = useState(false);
  const [usdaBusy, setUsdaBusy] = useState(false);
  const [usdaQ, setUsdaQ] = useState("");
  const [usdaResults, setUsdaResults] = useState<UsdaCandidate[]>([]);
  const [usdaErr, setUsdaErr] = useState("");
  const [usdaDemo, setUsdaDemo] = useState(false);
  const usdaReqRef = useRef(0);
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [historyEvents, setHistoryEvents] = useState<ScanEvent[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);

  const filtered = inventory.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  function openNew() {
    setDraft(emptyItem());
    setEditingId(null);
    setAllergensText("");
    setUsdaOpen(false);
    setUsdaQ("");
    setUsdaResults([]);
    setUsdaErr("");
    setUsdaDemo(false);
    setUsdaBusy(false);
    setModalOpen(true);
  }

  function openEdit(i: InventoryItem) {
    setDraft(i);
    setEditingId(i.id);
    setAllergensText((i.allergens || []).join(", "));
    setUsdaOpen(false);
    setUsdaQ(i.name);
    setUsdaResults([]);
    setUsdaErr("");
    setUsdaDemo(false);
    setUsdaBusy(false);
    setModalOpen(true);
  }

  async function save() {
    if (!draft.name.trim()) return;
    const allergens = allergensText.split(",").map((s) => s.trim()).filter(Boolean);
    const payload: Record<string, any> = {
      name: draft.name,
      category: draft.category,
      quantity: draft.quantity,
      unit: draft.unit,
      reorder_level: draft.reorderLevel,
      cost_per_unit: draft.costPerUnit,
      supplier: draft.supplier,
      ingredients_label: draft.ingredients_label,
      unit_weight: draft.unit_weight,
      allergens: allergens.length ? allergens : undefined,
      barcode: draft.barcode ? draft.barcode : null,
      nutrition_source: draft.nutritionSource,
      nutrition_fetched_at: draft.nutritionFetchedAt,
    };
    try {
      if (editingId) {
        await apiUpdateInventoryItem(editingId, payload);
      } else {
        const newId = `inv_${Date.now().toString(36)}`;
        await apiCreateInventoryItem({ ...payload, id: newId, active: draft.active ?? true } as any);
      }
      setModalOpen(false);
    } catch (err: any) {
      console.error("Save inventory item failed:", err);
      alert(`Failed to save item: ${err.message || err}`);
    }
  }

  async function remove(id: string, name: string) {
    const refs = (products || [])
      .filter((p) => (p.recipe || []).some((r) => r.inventoryItemId === id))
      .map((p) => p.name);
    const msg = refs.length
      ? `"${name}" is in the recipe of: ${refs.join(", ")}. Deactivating it will SKIP its deduction on future orders until it's re-added. Remove anyway?`
      : "Remove this inventory item? It can't be used in recipes until re-added.";
    if (!confirm(msg)) return;
    try {
      await apiDeleteInventoryItem(id);
    } catch (err: any) {
      console.error("Delete inventory item failed:", err);
      alert(`Failed to delete item: ${err.message || err}`);
    }
  }

  async function openHistory(item: InventoryItem) {
    setHistoryItem(item);
    setHistoryEvents([]);
    setHistoryBusy(true);
    try {
      setHistoryEvents(await fetchScanHistory(item.id, 50));
    } catch (err: any) {
      console.warn("Scan history load failed:", err);
    } finally {
      setHistoryBusy(false);
    }
  }

  function adjust(id: string, delta: number) {
    const current = inventory.find(i => i.id === id)?.quantity ?? 0;
    apiUpdateInventoryItem(id, {
      quantity: Math.max(0, +(current + delta).toFixed(2)),
    }).catch((err) => {
      console.warn("Adjust failed:", err);
    });
  }

  async function unbind(id: string, name: string) {
    if (!confirm(`Unbind the barcode from "${name}"? The item stays in inventory — you can scan and bind a new code anytime.`)) return;
    try {
      await apiUpdateInventoryItem(id, { barcode: null } as any);
    } catch (err: any) {
      console.error("Unbind failed:", err);
      alert(`Failed to unbind: ${err.message || err}`);
    }
  }

  async function usdaSearch() {
    if (!usdaQ.trim() || usdaBusy) return;
    const reqId = ++usdaReqRef.current;
    setUsdaBusy(true);
    setUsdaErr("");
    setUsdaDemo(false);
    try {
      const r = await lookupUsdaIngredient(usdaQ.trim(), 5);
      if (reqId !== usdaReqRef.current) return; // stale response — a newer search superseded this one
      setUsdaResults(r.candidates || []);
      setUsdaDemo(!!r.demo);
    } catch (e: any) {
      if (reqId !== usdaReqRef.current) return;
      setUsdaErr(e?.message || "Lookup failed");
      setUsdaResults([]);
    } finally {
      if (reqId === usdaReqRef.current) setUsdaBusy(false);
    }
  }

  function usdaApply(c: UsdaCandidate) {
    const existing = allergensText.split(",").map((s) => s.trim()).filter(Boolean);
    const merged = [...existing];
    for (const tag of c.allergenHints) if (!merged.includes(tag)) merged.push(tag);
    setAllergensText(merged.join(", "));
    const lb =
      c.portionGramWeight != null
        ? Math.round(c.portionGramWeight * 0.00220462 * 10000) / 10000
        : undefined;
    setDraft({
      ...draft,
      ingredients_label: c.ingredients || draft.ingredients_label,
      unit_weight: lb ?? draft.unit_weight,
      nutritionSource: `fdc:${c.fdcId}`,
      nutritionFetchedAt: new Date().toISOString(),
    });
    setUsdaOpen(false);
    setUsdaResults([]);
    setUsdaErr("");
  }

  const totalValue = inventory.reduce((s, i) => s + i.quantity * i.costPerUnit, 0);
  const lowCount = inventory.filter((i) => i.quantity <= i.reorderLevel).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3 text-sm">
          <div className="rounded-xl border border-sand-200 bg-white px-4 py-2.5">
            <p className="text-xs text-cocoa-muted">Inventory value</p>
            <p className="font-semibold text-cocoa">{formatCurrency(totalValue)}</p>
          </div>
          <div className="rounded-xl border border-hibiscus-light/30 bg-hibiscus-light/10 px-4 py-2.5">
            <p className="text-xs text-hibiscus">Low stock</p>
            <p className="font-semibold text-hibiscus">{lowCount} items</p>
          </div>
        </div>
        <button
          onClick={() => setScanOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-palm/30 bg-white px-4 py-2.5 text-sm font-medium text-palm shadow-sm transition hover:bg-palm/5"
        >
          <ScanLine size={16} /> Scan
        </button>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-xl bg-palm px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:shadow-md"
        >
          <Plus size={16} /> Add Item
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50 text-left text-xs uppercase tracking-wide text-cocoa-muted">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Quantity</th>
                <th className="px-4 py-3">Reorder at</th>
                <th className="px-4 py-3">Cost/unit</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {filtered.map((i) => {
                const low = i.quantity <= i.reorderLevel;
                return (
                  <tr key={i.id} className="hover:bg-sand-50">
                    <td className="px-4 py-3 font-medium text-cocoa">
                      <div>{i.name}</div>
                      {i.barcode && i.barcode !== i.id && (
                        <div className="mt-0.5 flex items-center gap-1">
                          <span className="rounded bg-sand-100 px-1.5 py-0.5 font-mono text-[10px] text-cocoa-muted">{i.barcode}</span>
                          <button
                            onClick={() => unbind(i.id, i.name)}
                            title="Unbind barcode"
                            className="rounded p-0.5 text-cocoa-muted hover:bg-sand-100 hover:text-hibiscus"
                          >
                            <Unlink size={10} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-cocoa-muted">{i.category}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => adjust(i.id, -1)}
                          className="rounded-md border border-sand-200 p-1 text-cocoa-muted hover:bg-sand-100"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-16 text-center">
                          {i.quantity} {i.unit}
                        </span>
                        <button
                          onClick={() => adjust(i.id, 1)}
                          className="rounded-md border border-sand-200 p-1 text-cocoa-muted hover:bg-sand-100"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-cocoa-muted">
                      {i.reorderLevel} {i.unit}
                    </td>
                    <td className="px-4 py-3 text-cocoa-muted">{formatCurrency(i.costPerUnit)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={low ? "low" : "ok"}>{low ? "Low stock" : "In stock"}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openHistory(i)}
                          title="Scan history"
                          className="rounded-lg p-1.5 text-cocoa-muted hover:bg-sand-100"
                        >
                          <History size={14} />
                        </button>
                        <button
                          onClick={() => openEdit(i)}
                          className="rounded-lg p-1.5 text-cocoa-muted hover:bg-sand-100"
                        >
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => remove(i.id, i.name)} className="rounded-lg p-1.5 text-hibiscus hover:bg-hibiscus-light/10">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-cocoa-muted">
                    No inventory items found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit Item" : "Add Inventory Item"}>
        <div className="space-y-3">
          <Field label="Item name">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input" />
          </Field>
          <Field label="Category">
            <input
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              className="input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <input
                type="number"
                step="0.01"
                value={draft.quantity}
                onChange={(e) => setDraft({ ...draft, quantity: Number(e.target.value) })}
                className="input"
              />
            </Field>
            <Field label="Unit">
              <input value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} className="input" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reorder level">
              <input
                type="number"
                step="0.01"
                value={draft.reorderLevel}
                onChange={(e) => setDraft({ ...draft, reorderLevel: Number(e.target.value) })}
                className="input"
              />
            </Field>
            <Field label="Cost per unit ($)">
              <input
                type="number"
                step="0.01"
                value={draft.costPerUnit}
                onChange={(e) => setDraft({ ...draft, costPerUnit: Number(e.target.value) })}
                className="input"
              />
            </Field>
          </div>
          <Field label="Supplier">
            <input
              value={draft.supplier}
              onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Barcode (optional)">
            <div className="flex gap-2">
              <input
                value={draft.barcode || ""}
                onChange={(e) => setDraft({ ...draft, barcode: e.target.value || undefined })}
                placeholder="Scan or type a code — leave blank to clear"
                className="input font-mono flex-1"
              />
              {draft.barcode && (
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, barcode: undefined })}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sand-200 px-2.5 text-xs text-cocoa-muted hover:bg-sand-100"
                >
                  <Unlink size={12} /> Clear
                </button>
              )}
            </div>
          </Field>

          <div className="rounded-xl border border-sand-200 bg-sand-50 p-3">
            <p className="mb-2 text-xs font-medium text-cocoa">Label info (used to auto-generate product labels)</p>
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-cocoa-muted">Sub-ingredients label (legal)</label>
                  <button
                    type="button"
                    onClick={() => {
                      setUsdaQ(draft.name || usdaQ);
                      setUsdaOpen(!usdaOpen);
                      setUsdaResults([]);
                      setUsdaErr("");
                    }}
                    className="rounded-lg border border-palm/30 px-2.5 py-1 text-xs font-medium text-palm hover:bg-palm/5"
                  >
                    Find ingredient data
                  </button>
                </div>
                {draft.nutritionSource && (
                  <p className="mb-1 text-[11px] text-cocoa-muted">
                    Filled from USDA · {(draft.nutritionFetchedAt || "").slice(0, 10)} — click "Find ingredient
                    data" to refetch.
                  </p>
                )}
                <textarea
                  value={draft.ingredients_label || ""}
                  onChange={(e) => setDraft({ ...draft, ingredients_label: e.target.value || undefined })}
                  placeholder='e.g. "Enriched flour (wheat flour, niacin, …)". Leave blank for packaging.'
                  rows={2}
                  className="input"
                />
                {usdaOpen && (
                  <div className="mt-2 rounded-lg border border-sand-200 bg-white p-2">
                    <div className="flex gap-2">
                      <input
                        value={usdaQ}
                        onChange={(e) => setUsdaQ(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") usdaSearch(); }}
                        placeholder="Search USDA FoodData Central…"
                        className="input flex-1"
                      />
                      <button
                        onClick={usdaSearch}
                        disabled={usdaBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-palm px-3 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        <Search size={12} /> {usdaBusy ? "Searching…" : "Search"}
                      </button>
                    </div>
                    {usdaDemo && (
                      <p className="mt-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
                        USDA demo key in use — max 30 lookups/hour. Ask the owner to set the USDA_KEY secret for
                        full access.
                      </p>
                    )}
                    {usdaErr && <p className="mt-2 text-xs text-hibiscus">{usdaErr}</p>}
                    <ul className="mt-2 max-h-48 divide-y divide-sand-100 overflow-y-auto">
                      {usdaResults.map((c) => (
                        <li key={c.fdcId}>
                          <button
                            type="button"
                            onClick={() => usdaApply(c)}
                            className="w-full px-2 py-2 text-left hover:bg-sand-50"
                          >
                            <div className="text-sm font-medium text-cocoa">{c.name}</div>
                            <div className="text-xs text-cocoa-muted">
                              {c.dataType}
                              {c.foodCategory ? ` · ${c.foodCategory}` : ""}
                              {c.portionGramWeight != null
                                ? ` · ${Math.round(c.portionGramWeight)} g/portion`
                                : ""}
                            </div>
                          </button>
                        </li>
                      ))}
                      {!usdaBusy && usdaResults.length === 0 && (
                        <li className="px-2 py-3 text-xs text-cocoa-muted">No matches — try a different search.</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
              <Field label="Allergens (comma-separated tags)">
                <input
                  value={allergensText}
                  onChange={(e) => setAllergensText(e.target.value)}
                  placeholder="Wheat, Milk, Eggs, Soy, …"
                  className="input"
                />
              </Field>
              <Field label="Weight per unit (lb)">
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={draft.unit_weight ?? ""}
                  onChange={(e) => setDraft({ ...draft, unit_weight: e.target.value === "" ? undefined : Number(e.target.value) })}
                  placeholder="lb: 1 / dozen eggs: 1.5 / bottle vanilla: 0.25"
                  className="input"
                />
              </Field>
            </div>
          </div>

          <button onClick={save} className="w-full rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md">
            {editingId ? "Save Changes" : "Add Item"}
          </button>
        </div>
      </Modal>

      {scanOpen && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-palm/40 backdrop-blur-sm"><div className="rounded-xl bg-white p-6 shadow-lg">Loading scanner…</div></div>}>
          <ScanModal open={scanOpen} onClose={() => setScanOpen(false)} />
        </Suspense>
      )}

      <Modal open={!!historyItem} onClose={() => setHistoryItem(null)} title={historyItem ? `Scan history — ${historyItem.name}` : "Scan history"} wide>
        {historyBusy ? (
          <p className="text-sm text-cocoa-muted">Loading…</p>
        ) : historyEvents.length === 0 ? (
          <p className="text-sm text-cocoa-muted">No scan events recorded for this item yet.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-xl border border-sand-100">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50 text-left text-xs uppercase tracking-wide text-cocoa-muted">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Delta</th>
                  <th className="px-3 py-2">Who</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sand-100">
                {historyEvents.map((ev) => (
                  <tr key={ev.id} className="hover:bg-sand-50">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-cocoa-muted">{ev.created_at}</td>
                    <td className="px-3 py-2 text-cocoa">{scanActionLabel(ev.action)}</td>
                    <td className="px-3 py-2 font-mono text-xs text-cocoa-muted">{ev.code}</td>
                    <td className="px-3 py-2 text-cocoa-muted">
                      {ev.action === "adjust" && ev.delta != null ? `${ev.delta > 0 ? "+" : ""}${ev.delta}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-cocoa-muted">{ev.actor || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

function scanActionLabel(action: string): string {
  switch (action) {
    case "lookup": return "Scanned";
    case "miss": return "No match";
    case "bind": return "Bound";
    case "unbind": return "Unbound";
    case "adjust": return "Adjusted";
    case "create": return "Created";
    case "conflict": return "Conflict";
    case "enrich_off": return "Enriched (OFF)";
    case "enrich_off_miss": return "Enrich miss";
    case "enrich_off_failed": return "Enrich failed";
    case "enrich_off_skipped": return "Enrich skipped";
    default: return action;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-cocoa-muted">{label}</label>
      {children}
    </div>
  );
}
