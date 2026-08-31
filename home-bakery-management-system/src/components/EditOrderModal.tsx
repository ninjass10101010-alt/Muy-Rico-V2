import { useEffect, useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import Modal from "./ui/Modal";
import ProductIcon from "./ProductIcon";
import { useStore } from "../context/StoreContext";
import { computeOrderTotals } from "../utils/format";
import type { Order, OrderItem } from "../types";

export default function EditOrderModal({
  open,
  order,
  onClose,
  onSaved,
}: {
  open: boolean;
  order: Order | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { products, apiUpdateOrder } = useStore();
  const [items, setItems] = useState<OrderItem[]>([]);
  const [discount, setDiscount] = useState(0);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [discountDraft, setDiscountDraft] = useState("");
  const [productPick, setProductPick] = useState("");
  const [flavorSelections, setFlavorSelections] = useState<Record<string, string>>({});
  const [packPick, setPackPick] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const itemKey = (i: OrderItem) => `${i.productId ?? ""}|${i.flavorNote ?? ""}`;

  useEffect(() => {
    if (open && order) {
      setItems(order.items.map((i) => ({ ...i })));
      setDiscount(order.discount);
      setPriceDrafts(Object.fromEntries(order.items.map((i) => [itemKey(i), String(i.price)])));
      setDiscountDraft(String(order.discount));
      setProductPick("");
      setFlavorSelections({});
      setPackPick("");
      setErrorMsg("");
      setSubmitting(false);
    }
  }, [open, order]);

  const activeProducts = products.filter((p) => p.active);
  const pickedProduct = products.find((p) => p.id === productPick);
  const pickedFlavorGroups = pickedProduct?.flavor_groups ?? [];
  const pickedPacks = pickedProduct?.pack_sizes ?? [];
  const activePack = pickedPacks.find((pk) => pk.id === packPick) ?? pickedPacks[0] ?? null;
  const flavorsComplete = pickedFlavorGroups.every((g) => !!flavorSelections[g.name]);

  const totals = useMemo(() => computeOrderTotals(items, discount), [items, discount]);

  function addItem() {
    const p = products.find((pr) => pr.id === productPick);
    if (!p) return;
    const groups = p.flavor_groups ?? [];
    if (groups.some((g) => !flavorSelections[g.name])) return;
    const packNote = activePack ? ` (${activePack.label})` : "";
    const flavorNote = packNote + (groups.length
      ? ` (${groups.map((g) => `${g.name}: ${flavorSelections[g.name]}`).join(", ")})`
      : "");
    const packPrice = activePack ? Number(activePack.price) : p.price;
    const displayName = p.name + flavorNote;
    setItems((prev) => {
      const existing = prev.find((i) => itemKey(i) === `${p.id}|${flavorNote}`);
      if (existing) {
        return prev.map((i) =>
          itemKey(i) === `${p.id}|${flavorNote}` ? { ...i, qty: i.qty + 1 } : i,
        );
      }
      return [...prev, { productId: p.id, name: displayName, emoji: p.emoji, qty: 1, price: packPrice, flavorNote }];
    });
    setFlavorSelections({});
    setPackPick("");
  }

  function updateQty(key: string, delta: number) {
    setItems((prev) =>
      prev.map((i) => (itemKey(i) === key ? { ...i, qty: Math.max(1, i.qty + delta) } : i)),
    );
  }

  function updatePrice(key: string, price: number) {
    setItems((prev) =>
      prev.map((i) => (itemKey(i) === key ? { ...i, price: Number.isFinite(price) ? Math.max(0, price) : 0 } : i)),
    );
  }

  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((i) => itemKey(i) !== key) : prev));
  }

  async function handleSave() {
    if (!order || submitting) return;
    setSubmitting(true);
    setErrorMsg("");
    try {
      await apiUpdateOrder(Number(order.id), {
        items_json: items.map((i) => ({
          name: i.name,
          qty: i.qty,
          price: i.price,
          productId: i.productId ?? null,
          emoji: i.emoji,
          flavorNote: i.flavorNote,
        })),
        discount_cents: Math.round((Number.isFinite(Number(discountDraft)) ? Math.max(0, Number(discountDraft)) : 0) * 100),
      });
      onSaved();
    } catch (err: any) {
      setErrorMsg(err.message || "Could not save changes. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={order ? `Edit Order ${order.orderNumber}` : "Edit Order"} wide>
      {order && (
        <div className="space-y-4">
          <p className="text-sm text-cocoa-muted">{order.customerName}</p>
          {order.inventoryDeducted && (
            <div className="rounded-xl bg-coral-light/20 p-3 text-sm text-cocoa">
              Inventory was already deducted for this order — changing quantities won't adjust inventory.
            </div>
          )}

          <div className="space-y-2">
            {items.map((item) => (
              <div key={itemKey(item)} className="flex items-center justify-between gap-2 rounded-lg bg-sand-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-cocoa">
                    <ProductIcon emoji={item.emoji} imageUrl={products.find((p) => p.id === item.productId)?.image_url} size={18} /> {item.name}
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateQty(itemKey(item), -1)}
                    className="rounded-md bg-white p-1 text-cocoa-muted shadow hover:bg-sand-100"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-5 text-center text-sm">{item.qty}</span>
                  <button
                    onClick={() => updateQty(itemKey(item), 1)}
                    className="rounded-md bg-white p-1 text-cocoa-muted shadow hover:bg-sand-100"
                  >
                    <Plus size={12} />
                  </button>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={priceDrafts[itemKey(item)] ?? String(item.price)}
                    onChange={(e) => {
                      const key = itemKey(item);
                      const raw = e.target.value;
                      setPriceDrafts((d) => ({ ...d, [key]: raw }));
                      updatePrice(key, Number(raw));
                    }}
                    onBlur={() => {
                      const key = itemKey(item);
                      const v = Number(priceDrafts[key] ?? String(item.price));
                      setPriceDrafts((d) => ({ ...d, [key]: String(Number.isFinite(v) ? Math.max(0, v) : 0) }));
                    }}
                    className="w-20 rounded-md border border-sand-200 px-2 py-1 text-right text-sm outline-none focus:border-palm"
                  />
                  <button
                    onClick={() => removeItem(itemKey(item))}
                    disabled={items.length <= 1}
                    className="ml-1 rounded-md p-1 text-hibiscus hover:bg-hibiscus-light/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <select
              value={productPick}
              onChange={(e) => {
                setProductPick(e.target.value);
                setFlavorSelections({});
                setPackPick("");
              }}
              className="flex-1 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
            >
              <option value="">Add item…</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ${(p.pack_sizes?.[0]?.price ?? p.price).toFixed(2)}
                </option>
              ))}
            </select>
            <button
              onClick={addItem}
              disabled={!productPick || !flavorsComplete}
              className="rounded-xl bg-coral px-3 py-2 text-sm font-medium text-white hover:bg-coral/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus size={16} />
            </button>
          </div>

          {pickedPacks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pickedPacks.map((pk) => (
                <button
                  key={pk.id}
                  type="button"
                  onClick={() => setPackPick(pk.id)}
                  className={`rounded-xl border px-3 py-2 text-left text-xs transition ${
                    (activePack?.id ?? "") === pk.id
                      ? "border-palm bg-palm/10 text-cocoa"
                      : "border-sand-200 text-cocoa-muted hover:border-sand-300"
                  }`}
                >
                  <span className="block font-semibold">{pk.label}</span>
                  <span className="block">{pk.unit_label || `$${Number(pk.price).toFixed(2)}`}</span>
                </button>
              ))}
            </div>
          )}

          {pickedFlavorGroups.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {pickedFlavorGroups.map((g) => (
                <select
                  key={g.name}
                  value={flavorSelections[g.name] || ""}
                  onChange={(e) => setFlavorSelections((s) => ({ ...s, [g.name]: e.target.value }))}
                  className="rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
                >
                  <option value="">{g.name}…</option>
                  {g.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ))}
            </div>
          )}

          <div className="rounded-xl bg-sand-50 p-3 text-sm">
            <div className="flex justify-between text-cocoa-muted">
              <span>Subtotal</span>
              <span>${totals.subtotal.toFixed(2)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-cocoa-muted">
              <span>Discount</span>
              <input
                type="number"
                min={0}
                value={discountDraft}
                onChange={(e) => {
                  setDiscountDraft(e.target.value);
                  const v = Number(e.target.value);
                  setDiscount(Number.isFinite(v) ? Math.max(0, v) : 0);
                }}
                onBlur={() => setDiscountDraft(String(Number.isFinite(Number(discountDraft)) ? Math.max(0, Number(discountDraft)) : 0))}
                className="w-20 rounded-md border border-sand-200 px-2 py-0.5 text-right outline-none focus:border-palm"
              />
            </div>
            <div className="mt-2 flex justify-between border-t border-sand-200 pt-2 text-base font-semibold text-cocoa">
              <span>Total</span>
              <span>${totals.total.toFixed(2)}</span>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-hibiscus-light/10 p-3 text-sm text-hibiscus">{errorMsg}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={submitting}
              className="flex-1 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? "Saving..." : "Save Changes"}
            </button>
            <button
              onClick={onClose}
              className="rounded-xl border border-sand-200 px-4 py-2.5 text-sm text-cocoa-muted hover:bg-sand-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
