import { useState } from "react";
import { ChevronDown, Tag, Trash2 } from "lucide-react";
import type { LabelTemplate } from "../../../types";
import { useStore } from "../../../context/StoreContext";
import { newId } from "../../../utils/format";
import { makeFallback, normalizeLabel } from "../templateUtils";
import { useEditorStore } from "../state";

const RECENT_KEY = "muyrico.labelstudio.recent";
const DRAFT_KEY = "muyrico.labelstudio.draft";
const RECENT_CAP = 6;

interface DraftInfo {
  id: string;
  savedAt: string;
  doc: LabelTemplate;
}

interface Props {
  filterByOrder?: string | null;
  filterByProduct?: string | null;
  onTemplateOpen?: () => void;
}

function readDraft(): DraftInfo | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftInfo;
    if (!parsed || !parsed.id || !parsed.doc) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function productToLabelFields(p: {
  name: string;
  description?: string;
  ingredients?: string;
  allergens?: string;
  price: number;
  emoji?: string;
}): Partial<LabelTemplate> {
  return {
    productName: p.name,
    details: p.description || "",
    ingredients: p.ingredients || "",
    allergens: p.allergens || "",
    price: `$${p.price.toFixed(2)}`,
    logoEmoji: p.emoji || "🧁",
  };
}

function TemplateRow({
  t,
  currentId,
  badge,
  onOpen,
  onDelete,
}: {
  t: LabelTemplate;
  currentId: string;
  badge?: string;
  onOpen: (t: LabelTemplate) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-lg border py-1 pl-2 pr-1 text-xs ${
        t.id === currentId ? "border-coral bg-coral-light/20" : "border-sand-200"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(t)}
        className="flex min-h-11 min-w-0 flex-1 items-center truncate pr-1 text-left font-medium text-cocoa-muted"
      >
        <span className="truncate">
          {badge && <span className="mr-1">{badge}</span>}
          {t.name}
        </span>
      </button>
      <button
        type="button"
        title="Delete template"
        onClick={() => onDelete(t.id)}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-hibiscus transition hover:bg-hibiscus-light/10 hover:text-hibiscus-light"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function GroupHeader({
  title,
  count,
  open,
  onToggle,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex min-h-11 w-full items-center justify-between px-1 text-left"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-cocoa-muted">
        {title}
        <span className="rounded-full bg-sand-100 px-1.5 py-0.5 text-[10px] font-medium text-cocoa-muted">
          {count}
        </span>
      </span>
      <ChevronDown
        size={14}
        className={`text-cocoa-muted transition-transform ${open ? "rotate-180" : ""}`}
      />
    </button>
  );
}

export default function TemplatesTab({ filterByOrder, filterByProduct, onTemplateOpen }: Props) {
  const { profile, labelTemplates, products, handleCreateLabel, handleDeleteLabel } = useStore();
  const doc = useEditorStore((s) => s.doc);
  const loadTemplate = useEditorStore((s) => s.loadTemplate);
  const select = useEditorStore((s) => s.select);
  const setDoc = useEditorStore((s) => s.setDoc);

  const [saving, setSaving] = useState(false);
  const [showProduct, setShowProduct] = useState(true);
  const [showCustom, setShowCustom] = useState(true);
  const [showOrderLabels, setShowOrderLabels] = useState(() => Boolean(filterByOrder));
  const [recentIds, setRecentIds] = useState<string[]>(readRecents);
  const [draft, setDraft] = useState<DraftInfo | null>(readDraft);

  const productTemplates = labelTemplates.filter((t) => t.templateKind === "product");
  const customTemplates = labelTemplates.filter((t) => (t.templateKind || "custom") === "custom");
  const orderLabels = labelTemplates.filter(
    (t) => t.templateKind === "order" || /^MR-\d+|^Order #\d+/.test(t.name)
  );
  const orderTemplates = filterByOrder
    ? labelTemplates.filter(
        (t) => t.name.startsWith(`MR-${filterByOrder}`) || t.name.startsWith(`Order #${filterByOrder}`)
      )
    : null;
  const product = filterByProduct
    ? products.find((p) => p.id === filterByProduct) || null
    : null;
  const productMissing =
    Boolean(product) && !productTemplates.some((t) => t.productId === product?.id);

  const draftDiffers = Boolean(
    draft && draft.id === doc.id && JSON.stringify(draft.doc) !== JSON.stringify(doc)
  );

  function recordRecent(id: string) {
    try {
      const next = [id, ...readRecents().filter((x) => x !== id)].slice(0, RECENT_CAP);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      setRecentIds(next);
    } catch {
      /* storage unavailable */
    }
  }

  function openTemplate(t: LabelTemplate) {
    loadTemplate(normalizeLabel(t, profile.website));
    recordRecent(t.id);
    select(null);
    onTemplateOpen?.();
  }

  function removeTemplate(id: string) {
    handleDeleteLabel(id);
    if (doc.id === id && labelTemplates.length > 1) {
      const next = labelTemplates.find((t) => t.id !== id);
      if (next) loadTemplate(normalizeLabel(next, profile.website));
    }
  }

  async function duplicateAsNew() {
    if (saving) return;
    setSaving(true);
    try {
      const copy: LabelTemplate = {
        ...doc,
        id: newId("label"),
        name: "Untitled Label",
        // A duplicate never keeps the product/order association.
        templateKind: "custom",
        productId: null,
      };
      await handleCreateLabel(copy);
      loadTemplate(normalizeLabel(copy, profile.website));
    } catch (err) {
      console.warn("Duplicate failed:", err);
    } finally {
      setSaving(false);
    }
  }

  async function createProductTemplate() {
    if (!product || saving) return;
    setSaving(true);
    try {
      const fresh = makeFallback(profile.website);
      const saved: LabelTemplate = {
        ...fresh,
        ...productToLabelFields(product),
        id: newId("label"),
        name: `${product.emoji || ""} ${product.name}`.trim(),
        templateKind: "product",
        productId: product.id,
      };
      await handleCreateLabel(saved);
      loadTemplate(normalizeLabel(saved, profile.website));
    } catch (err) {
      console.warn("Could not create product template:", err);
    } finally {
      setSaving(false);
    }
  }

  function restoreDraft() {
    if (!draft) return;
    setDoc(draft.doc, false); // no history entry; dirty stays true
    setDraft(null);
  }

  function discardDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setDraft(null);
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      {draftDiffers && draft && (
        <div className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-2.5 text-xs text-amber-900">
          <p className="font-semibold">Restore unsaved changes from last session?</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={restoreDraft}
              className="min-h-11 flex-1 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600"
            >
              Restore
            </button>
            <button
              type="button"
              onClick={discardDraft}
              className="min-h-11 flex-1 rounded-lg border border-amber-300 px-3 py-2 text-xs font-medium text-amber-900 transition hover:bg-amber-200"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {recentIds.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-cocoa-muted">
            Recent
          </p>
          <div className="flex flex-wrap gap-1.5">
            {recentIds.map((id) => {
              const t = labelTemplates.find((x) => x.id === id);
              if (!t) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => openTemplate(t)}
                  title={t.name}
                  className="max-w-full truncate rounded-full border border-sand-200 bg-sand-50 px-3 py-1.5 text-[11px] font-medium text-cocoa-muted transition hover:border-palm hover:text-palm"
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {filterByOrder && orderTemplates && (
        <div className="flex items-center gap-2 rounded-lg bg-coral/10 px-2.5 py-2 text-xs font-medium text-coral">
          <Tag size={12} className="shrink-0" />
          <span>
            Showing labels for {filterByOrder}
            {orderTemplates.length === 0 && " — none generated yet"}
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={duplicateAsNew}
        disabled={saving}
        className="min-h-11 w-full rounded-lg border border-dashed border-sand-300 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-60"
      >
        + Duplicate as new
      </button>

      {/* Product templates — one per product, used by order labels */}
      <div>
        <GroupHeader
          title="Product templates"
          count={productTemplates.length}
          open={showProduct}
          onToggle={() => setShowProduct((v) => !v)}
        />
        {showProduct && (
          <div className="space-y-1.5">
            {product && productMissing && (
              <div className="rounded-lg border border-coral/30 bg-coral-light/20 p-2.5 text-xs text-cocoa">
                <p className="font-medium text-coral">No template for {product.name} yet</p>
                <p className="mt-1 text-cocoa-muted">
                  Create one — every order label for this product will start from it.
                </p>
                <button
                  type="button"
                  onClick={createProductTemplate}
                  disabled={saving}
                  className="mt-2 min-h-11 w-full rounded-lg bg-palm py-1.5 text-xs font-medium text-white transition hover:shadow disabled:opacity-60"
                >
                  + Create {product.name} template
                </button>
              </div>
            )}
            {productTemplates.length === 0 && !product && (
              <p className="py-2 text-center text-[11px] text-cocoa-muted">
                No product templates yet. Open a product → Label to create one.
              </p>
            )}
            {productTemplates.map((t) => (
              <TemplateRow
                key={t.id}
                t={t}
                currentId={doc.id}
                onOpen={openTemplate}
                onDelete={removeTemplate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Custom templates — standalone labels */}
      <div>
        <GroupHeader
          title="Custom"
          count={customTemplates.length}
          open={showCustom}
          onToggle={() => setShowCustom((v) => !v)}
        />
        {showCustom && (
          <div className="space-y-1.5">
            {customTemplates.length === 0 && (
              <p className="py-2 text-center text-[11px] text-cocoa-muted">
                Save this label or use “Duplicate as new” to start one here.
              </p>
            )}
            {customTemplates.map((t) => (
              <TemplateRow
                key={t.id}
                t={t}
                currentId={doc.id}
                onOpen={openTemplate}
                onDelete={removeTemplate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Order labels — snapshots generated from orders */}
      <div>
        <GroupHeader
          title="Order labels"
          count={orderLabels.length}
          open={showOrderLabels}
          onToggle={() => setShowOrderLabels((v) => !v)}
        />
        {showOrderLabels && (
          <div className="space-y-1.5">
            {orderLabels.length === 0 && (
              <p className="py-2 text-center text-[11px] text-cocoa-muted">
                Generate labels from an order to see them here.
              </p>
            )}
            {orderLabels.map((t) => (
              <TemplateRow
                key={t.id}
                t={t}
                currentId={doc.id}
                badge="🏷️"
                onOpen={openTemplate}
                onDelete={removeTemplate}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
