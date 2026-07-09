import { useState } from "react";
import { Minus, Pencil, Plus, Trash2 } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import Badge from "../components/ui/Badge";
import { formatCurrency } from "../utils/format";
import type { InventoryItem } from "../types";

const emptyItem = (): InventoryItem => ({
  id: "",
  name: "",
  category: "Dry Goods",
  quantity: 0,
  unit: "each",
  reorderLevel: 5,
  costPerUnit: 0,
  supplier: "",
});

export default function Inventory({ search }: { search: string }) {
  const { inventory, apiCreateInventoryItem, apiUpdateInventoryItem, apiDeleteInventoryItem } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<InventoryItem>(emptyItem());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [allergensText, setAllergensText] = useState("");

  const filtered = inventory.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()));

  function openNew() {
    setDraft(emptyItem());
    setEditingId(null);
    setAllergensText("");
    setModalOpen(true);
  }

  function openEdit(i: InventoryItem) {
    setDraft(i);
    setEditingId(i.id);
    setAllergensText((i.allergens || []).join(", "));
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

  async function remove(id: string) {
    if (!confirm("Remove this inventory item? It can't be used in recipes until re-added.")) return;
    try {
      await apiDeleteInventoryItem(id);
    } catch (err: any) {
      console.error("Delete inventory item failed:", err);
      alert(`Failed to delete item: ${err.message || err}`);
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
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-mid-green to-palm px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:shadow-md"
        >
          <Plus size={16} /> Add Item
        </button>
      </div>

      <div className="overflow-hidden rounded-[40px_12px_40px_12px] border border-sand-200 bg-white shadow-sm">
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
                    <td className="px-4 py-3 font-medium text-cocoa">{i.name}</td>
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
                          onClick={() => openEdit(i)}
                          className="rounded-lg p-1.5 text-cocoa-muted hover:bg-sand-100"
                        >
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => remove(i.id)} className="rounded-lg p-1.5 text-hibiscus hover:bg-hibiscus-light/10">
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

          <div className="rounded-xl border border-sand-200 bg-sand-50 p-3">
            <p className="mb-2 text-xs font-medium text-cocoa">Label info (used to auto-generate product labels)</p>
            <div className="space-y-3">
              <Field label="Sub-ingredients label (legal)">
                <textarea
                  value={draft.ingredients_label || ""}
                  onChange={(e) => setDraft({ ...draft, ingredients_label: e.target.value || undefined })}
                  placeholder='e.g. "Enriched flour (wheat flour, niacin, …)". Leave blank for packaging.'
                  rows={2}
                  className="input"
                />
              </Field>
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

          <button onClick={save} className="w-full rounded-xl bg-gradient-to-r from-mid-green to-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md">
            {editingId ? "Save Changes" : "Add Item"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-cocoa-muted">{label}</label>
      {children}
    </div>
  );
}
