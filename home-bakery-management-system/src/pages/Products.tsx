import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Tag as TagIcon, Sparkles } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import { formatCurrency } from "../utils/format";
import { composeLabelFromRecipe } from "../utils/label";
import type { Product } from "../types";
import type { Page } from "../App";

const EMOJI_CHOICES = ["🧁", "🎂", "🍪", "🥐", "🍞", "🍩", "🥧", "🍫", "🥯", "🍰"];

const emptyProduct = (): Product => ({
  id: "",
  name: "",
  category: "Cupcakes",
  price: 0,
  cost: 0,
  sku: "",
  emoji: "🧁",
  active: true,
  description: "",
  ingredients: "",
  allergens: "",
  recipe: [],
  auto_generate_label: true,
});

export default function Products({ search, goTo }: { search: string; goTo: (p: Page) => void }) {
  const { products, apiCreateProduct, apiUpdateProduct, apiDeleteProduct, inventory } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Product>(emptyProduct());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [flavorsText, setFlavorsText] = useState("");

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  // Live label preview when auto-generate is on
  const composedLabelPreview = useMemo(
    () => composeLabelFromRecipe(draft, inventory),
    [draft, inventory],
  );

  function openNew() {
    setDraft(emptyProduct());
    setEditingId(null);
    setFlavorsText("");
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setDraft(p);
    setEditingId(p.id);
    setFlavorsText((p.flavor_groups || []).join(", "));
    setModalOpen(true);
  }

  async function save() {
    if (!draft.name.trim()) return;
    const flavors = flavorsText.split(",").map((s) => s.trim()).filter(Boolean);
    const useAuto = draft.auto_generate_label !== false;
    const ingredients = useAuto ? composedLabelPreview.ingredients : (draft.ingredients || "");
    const allergens = useAuto ? composedLabelPreview.allergens : (draft.allergens || "");
    const payload: any = {
      ...draft,
      flavors,
      ingredients,
      allergens,
      auto_generate_label: useAuto,
    };
    try {
      if (editingId) {
        await apiUpdateProduct(editingId, payload);
      } else {
        const newId = `prod_${Date.now().toString(36)}`;
        await apiCreateProduct({ ...payload, id: newId });
      }
      setModalOpen(false);
    } catch (err: any) {
      console.error("Save product failed:", err);
      alert(`Failed to save product: ${err.message || err}`);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this product? It will be hidden from the menu.")) return;
    try {
      await apiDeleteProduct(id);
    } catch (err: any) {
      console.error("Delete product failed:", err);
      alert(`Failed to delete product: ${err.message || err}`);
    }
  }

  function toggleRecipe(inventoryItemId: string) {
    setDraft((d) => {
      const exists = d.recipe.find((r) => r.inventoryItemId === inventoryItemId);
      if (exists) {
        return { ...d, recipe: d.recipe.filter((r) => r.inventoryItemId !== inventoryItemId) };
      }
      return { ...d, recipe: [...d.recipe, { inventoryItemId, qtyPerUnit: 1 }] };
    });
  }

  function updateRecipeQty(inventoryItemId: string, qty: number) {
    setDraft((d) => ({
      ...d,
      recipe: d.recipe.map((r) => (r.inventoryItemId === inventoryItemId ? { ...r, qtyPerUnit: qty } : r)),
    }));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-mid-green to-palm px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:shadow-md"
        >
          <Plus size={16} /> Add Product
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <div key={p.id} className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-coral-light/20 text-2xl">
                  {p.emoji}
                </div>
                <div>
                  <p className="font-semibold text-cocoa">{p.name}</p>
                  <p className="text-xs text-cocoa-muted">{p.category} · {p.sku}</p>
                </div>
              </div>
              {!p.active && (
                <span className="rounded-full bg-sand-100 px-2 py-0.5 text-[10px] font-medium text-cocoa-muted">
                  Inactive
                </span>
              )}
            </div>
            <p className="mt-3 line-clamp-2 text-sm text-cocoa-muted">{p.description}</p>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="font-semibold text-cocoa">{formatCurrency(p.price)}</span>
              <span className="text-xs text-cocoa-muted">Cost {formatCurrency(p.cost)}</span>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => openEdit(p)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sand-200 py-1.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
              >
                <Pencil size={13} /> Edit
              </button>
              <button
                onClick={() => goTo("labels")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sand-200 py-1.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
              >
                <TagIcon size={13} /> Label
              </button>
              <button
                onClick={() => remove(p.id)}
                className="rounded-lg border border-sand-200 p-1.5 text-hibiscus hover:bg-hibiscus-light/10"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingId ? "Edit Product" : "Add Product"} wide>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-3">
            <Field label="Product name">
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Category">
              <input
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                className="input"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Price ($)">
                <input
                  type="number"
                  step="0.01"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
                  className="input"
                />
              </Field>
              <Field label="Cost to make ($)">
                <input
                  type="number"
                  step="0.01"
                  value={draft.cost}
                  onChange={(e) => setDraft({ ...draft, cost: Number(e.target.value) })}
                  className="input"
                />
              </Field>
            </div>
            <Field label="SKU">
              <input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} className="input" />
            </Field>
            <Field label="Description">
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={3}
                className="input"
              />
            </Field>
            <Field label="Description (Spanish)">
              <textarea
                value={draft.description_es || ""}
                onChange={(e) => setDraft({ ...draft, description_es: e.target.value || undefined })}
                rows={3}
                className="input"
                placeholder="Descripción en español"
              />
            </Field>
            <Field label="Flavor options (comma-separated, e.g. Vanilla, Chocolate)">
              <input
                value={flavorsText}
                onChange={(e) => setFlavorsText(e.target.value)}
                className="input"
                placeholder="Leave blank if not applicable"
              />
            </Field>
            <Field label="Image URL (paste a link to a photo hosted anywhere)">
              <input
                value={draft.image_url || ""}
                onChange={(e) => setDraft({ ...draft, image_url: e.target.value || undefined })}
                className="input"
                placeholder="https://... (browser will fall back to emoji if blank)"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-cocoa">
              <input
                type="checkbox"
                checked={draft.auto_generate_label !== false}
                onChange={(e) => setDraft({ ...draft, auto_generate_label: e.target.checked })}
              />
              <span className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-coral" />
                Auto-generate ingredients & allergens from recipe
              </span>
            </label>
            {draft.auto_generate_label !== false ? (
              <div className="rounded-xl border border-sand-200 bg-sand-50 p-3">
                <p className="mb-2 text-xs font-medium text-cocoa-muted">Label preview (live)</p>
                {composedLabelPreview.ingredients ? (
                  <>
                    <p className="mb-1 text-xs italic text-cocoa-muted">Ingredients:</p>
                    <p className="text-xs text-cocoa leading-relaxed">{composedLabelPreview.ingredients}</p>
                  </>
                ) : (
                  <p className="text-xs italic text-cocoa-muted">
                    Add recipe ingredients to preview the label.
                  </p>
                )}
                {composedLabelPreview.allergens && (
                  <>
                    <p className="mt-2 mb-1 text-xs italic text-cocoa-muted">Allergens:</p>
                    <p className="text-xs font-medium text-cocoa">{composedLabelPreview.allergens}</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <Field label="Ingredients (for labels)">
                  <textarea
                    value={draft.ingredients}
                    onChange={(e) => setDraft({ ...draft, ingredients: e.target.value })}
                    rows={3}
                    className="input"
                    placeholder="In descending order by weight, sub-ingredients in parentheses"
                  />
                </Field>
                <Field label="Allergens (for labels)">
                  <textarea
                    value={draft.allergens}
                    onChange={(e) => setDraft({ ...draft, allergens: e.target.value })}
                    rows={2}
                    className="input"
                    placeholder='e.g. "Contains: wheat, milk, eggs, soy"'
                  />
                </Field>
              </>
            )}
            <Field label="Icon">
              <div className="flex flex-wrap gap-2">
                {EMOJI_CHOICES.map((em) => (
                  <button
                    key={em}
                    onClick={() => setDraft({ ...draft, emoji: em })}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg ${
                      draft.emoji === em ? "border-coral bg-coral-light/20" : "border-sand-200"
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-sm text-cocoa-muted">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              Active (shown for ordering)
            </label>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-cocoa-muted">
              Recipe — link ingredients so inventory auto-deducts when this order is completed
            </p>
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-sand-100 p-2">
              {inventory.map((item) => {
                const rec = draft.recipe.find((r) => r.inventoryItemId === item.id);
                return (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-sand-50 px-3 py-2">
                    <label className="flex items-center gap-2 text-sm text-cocoa-muted">
                      <input type="checkbox" checked={!!rec} onChange={() => toggleRecipe(item.id)} />
                      {item.name}
                    </label>
                    {rec && (
                      <div className="flex items-center gap-1 text-xs text-cocoa-muted">
                        <input
                          type="number"
                          step="0.01"
                          value={rec.qtyPerUnit}
                          onChange={(e) => updateRecipeQty(item.id, Number(e.target.value))}
                          className="w-16 rounded-md border border-sand-200 px-1.5 py-1 text-right"
                        />
                        {item.unit}/unit
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              onClick={save}
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-mid-green to-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
            >
              {editingId ? "Save Changes" : "Add Product"}
            </button>
          </div>
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
