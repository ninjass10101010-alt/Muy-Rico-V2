import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2, Tag as TagIcon, Sparkles } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import { formatCurrency } from "../utils/format";
import { composeLabelFromRecipe } from "../utils/label";
import { uploadImage } from "../utils/api";
import type { FlavorGroup, PackSize, Product } from "../types";
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
  const [flavorGroups, setFlavorGroups] = useState<FlavorGroup[]>([]);
  const [packSizes, setPackSizes] = useState<PackSize[]>([]);

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  // Live label preview when auto-generate is on
  const composedLabelPreview = useMemo(
    () => composeLabelFromRecipe(draft, inventory),
    [draft, inventory],
  );

  function normalizeFlavors(p: Product): FlavorGroup[] {
    if (Array.isArray((p as any).flavor_groups) && (p as any).flavor_groups.length) {
      return (p as any).flavor_groups;
    }
    if (Array.isArray((p as any).flavors) && (p as any).flavors.length) {
      return [{ name: 'Flavor', options: (p as any).flavors }];
    }
    return [];
  }

  function normalizePacks(p: Product): PackSize[] {
    if (Array.isArray((p as any).pack_sizes) && (p as any).pack_sizes.length) {
      return (p as any).pack_sizes;
    }
    return [];
  }

  function openNew() {
    setDraft(emptyProduct());
    setEditingId(null);
    setFlavorGroups([]);
    setPackSizes([]);
    setModalOpen(true);
  }

  function openEdit(p: Product) {
    setDraft(p);
    setEditingId(p.id);
    setFlavorGroups(normalizeFlavors(p));
    setPackSizes(normalizePacks(p));
    setModalOpen(true);
  }

  async function save() {
    if (!draft.name.trim()) return;
    const useAuto = draft.auto_generate_label !== false;
    const ingredients = useAuto ? composedLabelPreview.ingredients : (draft.ingredients || "");
    const allergens = useAuto ? composedLabelPreview.allergens : (draft.allergens || "");
    const payload: any = {
      ...draft,
      name_es: draft.name_es || null,
      flavor_groups: flavorGroups.filter(g => g.name.trim() && g.options.length),
      pack_sizes: packSizes.filter(pk => pk.label.trim() && pk.price >= 0),
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
            <Field label="Name (Spanish)">
              <input
                value={draft.name_es || ''}
                onChange={(e) => setDraft({ ...draft, name_es: e.target.value })}
                className="input"
                placeholder="Nombre en español"
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
              {packSizes.length > 0 ? (
                <Field label="Price ($)">
                  <p className="input flex items-center text-sm text-cocoa-muted">
                    Set per pack size below
                  </p>
                </Field>
              ) : (
                <Field label="Price ($)">
                  <input
                    type="number"
                    step="0.01"
                    value={draft.price}
                    onChange={(e) => setDraft({ ...draft, price: Number(e.target.value) })}
                    className="input"
                  />
                </Field>
              )}
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
            <Field label="Flavor Options">
              {flavorGroups.map((grp, gi) => (
                <div key={gi} className="mb-3 rounded-lg border border-sand-200 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <input
                      className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                      placeholder="Group name (e.g. Cake Flavor)"
                      value={grp.name}
                      onChange={(e) => {
                        const next = [...flavorGroups];
                        next[gi] = { ...grp, name: e.target.value };
                        setFlavorGroups(next);
                      }}
                    />
                    <input
                      className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                      placeholder="Spanish name (e.g. Sabor)"
                      value={grp.name_es || ''}
                      onChange={(e) => {
                        const next = [...flavorGroups];
                        next[gi] = { ...grp, name_es: e.target.value };
                        setFlavorGroups(next);
                      }}
                    />
                    <button
                      type="button"
                      className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600"
                      onClick={() => setFlavorGroups(flavorGroups.filter((_, i) => i !== gi))}
                    >Remove</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {grp.options.map((opt, oi) => (
                      <span key={oi} className="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-1 text-xs">
                        {opt}
                        <button type="button" className="text-cocoa-muted ml-1" onClick={() => {
                          const next = [...flavorGroups];
                          next[gi] = { ...grp, options: grp.options.filter((_, i) => i !== oi) };
                          setFlavorGroups(next);
                        }}>×</button>
                      </span>
                    ))}
                    <input
                      className="w-28 rounded-full border border-sand-200 px-2 py-1 text-xs"
                      placeholder="Add…"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                          const v = (e.target as HTMLInputElement).value.trim();
                          const next = [...flavorGroups];
                          next[gi] = { ...grp, options: [...grp.options, v] };
                          setFlavorGroups(next);
                          (e.target as HTMLInputElement).value = '';
                        }
                      }}
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="rounded-lg border border-dashed border-cocoa-muted px-3 py-1.5 text-xs font-medium text-cocoa-muted"
                onClick={() => setFlavorGroups([...flavorGroups, { name: '', options: [] }])}
                >+ Add Flavor Group</button>
              </Field>
              <Field label="Pack Sizes (bulk pricing)">
                {packSizes.map((pk, pi) => (
                  <div key={pi} className="mb-3 rounded-lg border border-sand-200 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <input
                        className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                        placeholder="Pack label (e.g. Dozen)"
                        value={pk.label}
                        onChange={(e) => {
                          const next = [...packSizes];
                          next[pi] = { ...pk, label: e.target.value };
                          setPackSizes(next);
                        }}
                      />
                      <input
                        className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                        placeholder="Spanish label (e.g. Docena)"
                        value={pk.label_es || ''}
                        onChange={(e) => {
                          const next = [...packSizes];
                          next[pi] = { ...pk, label_es: e.target.value };
                          setPackSizes(next);
                        }}
                      />
                      <input
                        className="w-20 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                        type="number"
                        placeholder="Qty"
                        value={pk.qty}
                        onChange={(e) => {
                          const next = [...packSizes];
                          next[pi] = { ...pk, qty: Number(e.target.value) || 1 };
                          setPackSizes(next);
                        }}
                      />
                      <input
                        className="w-24 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                        type="number"
                        step="0.01"
                        placeholder="Price"
                        value={pk.price}
                        onChange={(e) => {
                          const next = [...packSizes];
                          next[pi] = { ...pk, price: Number(e.target.value) || 0 };
                          setPackSizes(next);
                        }}
                      />
                      <button
                        type="button"
                        className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-600"
                        onClick={() => setPackSizes(packSizes.filter((_, i) => i !== pi))}
                      >Remove</button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                        placeholder="Badge (e.g. Save $8)"
                        value={pk.badge || ''}
                        onChange={(e) => {
                          const next = [...packSizes];
                          next[pi] = { ...pk, badge: e.target.value };
                          setPackSizes(next);
                        }}
                      />
                      <input
                        className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                        placeholder="Badge ES (e.g. ¡Ahorra $8!)"
                        value={pk.badge_es || ''}
                        onChange={(e) => {
                          const next = [...packSizes];
                          next[pi] = { ...pk, badge_es: e.target.value };
                          setPackSizes(next);
                        }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                        placeholder="Unit label (e.g. $3.33 ea)"
                        value={pk.unit_label || ''}
                        onChange={(e) => {
                          const next = [...packSizes];
                          next[pi] = { ...pk, unit_label: e.target.value };
                          setPackSizes(next);
                        }}
                      />
                      <input
                        className="flex-1 rounded-lg border border-sand-200 px-3 py-2 text-sm"
                        placeholder="Unit label ES (e.g. $3.33 c/u)"
                        value={pk.unit_label_es || ''}
                        onChange={(e) => {
                          const next = [...packSizes];
                          next[pi] = { ...pk, unit_label_es: e.target.value };
                          setPackSizes(next);
                        }}
                      />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="rounded-lg border border-dashed border-cocoa-muted px-3 py-1.5 text-xs font-medium text-cocoa-muted"
                  onClick={() => setPackSizes([...packSizes, { id: `pack_${Date.now().toString(36)}`, label: '', qty: 1, price: 0 }])}
                >+ Add Pack Size</button>
              </Field>
              <Field label="Product Image">
              {draft.image_url && (
                <img src={draft.image_url} alt="" className="mb-2 h-16 w-16 rounded-lg object-cover" />
              )}
              <input
                type="file"
                accept="image/*"
                className="block w-full text-sm"
                onChange={async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  try {
                    const { url } = await uploadImage(file);
                    setDraft({ ...draft, image_url: url });
                  } catch (err: any) {
                    alert('Upload failed: ' + err.message);
                  }
                }}
              />
              <input
                className="mt-2 w-full rounded-lg border border-sand-200 px-3 py-2 text-sm"
                placeholder="…or paste image URL"
                value={draft.image_url || ''}
                onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
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
              <div className="mt-2">
                <label className="mb-1 block text-xs text-cocoa-muted">Or type a custom emoji</label>
                <input
                  className="w-20 rounded-lg border border-sand-200 px-2 py-1 text-center text-lg"
                  value={draft.emoji}
                  onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
                />
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
            <label className="flex items-center gap-2 text-sm text-cocoa-muted">
              <input
                type="checkbox"
                checked={!!draft.featured}
                onChange={(e) => setDraft({ ...draft, featured: e.target.checked })}
              />
              ⭐ Featured on homepage (up to 4 shown in “Del Horno”)
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
