import { useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import Modal from "./ui/Modal";
import { useStore } from "../context/StoreContext";
import type { OrderItem, OrderSource, PaymentMethod, PaymentStatus } from "../types";
import { PAYMENT_METHOD_LABELS } from "../utils/format";

export default function OrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { products, customers, handleCreateCustomer, profile, apiCreateOrder } = useStore();
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("new");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<OrderSource>("in-person");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [productPick, setProductPick] = useState(products[0]?.id ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [foodColoring, setFoodColoring] = useState("");

  // Show food coloring field when order has cupcakes, cakepops, or custom cake
  const COLORABLE_PRODUCTS = ['prod_cupcakes', 'prod_cakepop', 'prod_custom_cake'];
  const showColoringField = items.some(i => COLORABLE_PRODUCTS.includes(i.productId));

  const activeProducts = products.filter((p) => p.active);
  const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[]).filter(
    (m) => profile.acceptedMethods[m],
  );

  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.qty * i.price, 0), [items]);
  const total = Math.max(0, +(subtotal - discount).toFixed(2));

  function addItem() {
    const p = products.find((pr) => pr.id === productPick);
    if (!p) return;
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === p.id);
      if (existing) {
        return prev.map((i) => (i.productId === p.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { productId: p.id, name: p.name, emoji: p.emoji, qty: 1, price: p.price }];
    });
  }

  function updateQty(productId: string, delta: number) {
    setItems((prev) =>
      prev
        .map((i) => (i.productId === productId ? { ...i, qty: Math.max(1, i.qty + delta) } : i))
        .filter(Boolean),
    );
  }

  function removeItem(productId: string) {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
  }

  function resetForm() {
    setCustomerMode("new");
    setCustomerId("");
    setCustomerName("");
    setPhone("");
    setSource("in-person");
    setItems([]);
    setPaymentMethod("cash");
    setPaymentStatus("paid");
    setDueDate(new Date().toISOString().slice(0, 10));
    setDiscount(0);
    setNotes("");
    setFoodColoring("");
  }

  async function handleSubmit() {
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    setErrorMsg("");

    try {
      let finalCustomerName = customerName;
      let finalPhone = phone;
      let newCustomer = null;

      if (customerMode === "existing") {
        const c = customers.find((cc) => cc.id === customerId);
        if (c) {
          finalCustomerName = c.name;
          finalPhone = c.phone;
        }
      } else if (customerName.trim()) {
        newCustomer = {
          id: `cust_${Math.random().toString(36).slice(2, 9)}`,
          name: customerName.trim(),
          phone: phone.trim(),
          email: "",
          notes: "",
          createdAt: new Date().toISOString(),
        };
        finalCustomerName = newCustomer.name;
        finalPhone = newCustomer.phone;
      }

      await apiCreateOrder({
        customer_name: finalCustomerName || "Walk-in Customer",
        phone: finalPhone || null,
        pickup_date: dueDate,
        items_json: items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, productId: i.productId })),
        total_cents: Math.round(total * 100),
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        notes: notes || null,
        source,
        food_coloring: foodColoring.trim() || null,
      });

      // Only add customer if the order succeeds
      if (newCustomer) {
        await handleCreateCustomer({
          id: newCustomer.id,
          name: newCustomer.name,
          phone: newCustomer.phone,
          email: newCustomer.email,
          notes: newCustomer.notes,
        });
      }

      resetForm();
      onClose();
    } catch (err: any) {
      console.error("Failed to create order:", err);
      setErrorMsg(err.message || "Failed to submit order. Check console or connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Order"
      wide
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Order source</label>
            <div className="flex gap-2">
              <button
                disabled
                className="flex-1 rounded-xl border border-palm bg-palm px-3 py-2 text-sm font-medium capitalize text-white opacity-90"
              >
                in-person
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Customer</label>
            <div className="mb-2 flex gap-2 text-xs">
              <button
                onClick={() => setCustomerMode("new")}
                className={`rounded-full px-3 py-1 ${customerMode === "new" ? "bg-coral-light/30 text-coral" : "bg-sand-100 text-cocoa-muted"}`}
              >
                New customer
              </button>
              <button
                onClick={() => setCustomerMode("existing")}
                className={`rounded-full px-3 py-1 ${customerMode === "existing" ? "bg-coral-light/30 text-coral" : "bg-sand-100 text-cocoa-muted"}`}
              >
                Existing customer
              </button>
            </div>
            {customerMode === "existing" ? (
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
              >
                <option value="">Select a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name"
                  className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
                />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
                />
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Pickup / due date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Payment method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
            >
              {enabledMethods.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Payment status</label>
            <div className="flex gap-2">
              {(["paid", "unpaid", "partial"] as PaymentStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setPaymentStatus(s)}
                  className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium capitalize transition ${
                    paymentStatus === s
                      ? "border-palm bg-palm text-white"
                      : "border-sand-200 text-cocoa-muted hover:border-sand-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Special instructions, allergies, decorations..."
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
            />
          </div>

          {showColoringField && (
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-cocoa-muted">
                🎨 Custom food coloring
                <span className="rounded-full bg-hibiscus-light/20 px-2 py-0.5 text-[10px] font-semibold text-hibiscus">Required on label per MI law</span>
              </label>
              <input
                value={foodColoring}
                onChange={(e) => setFoodColoring(e.target.value)}
                placeholder='e.g. Wilton Red, Wilton Blue 1, Yellow 5 — or "none" if no added color'
                className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
              />
              <p className="mt-1 text-[10px] text-cocoa-muted">Artificial colors will be auto-added to the generated label ingredients.</p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-cocoa-muted">Add items</label>
          <div className="flex gap-2">
            <select
              value={productPick}
              onChange={(e) => setProductPick(e.target.value)}
              className="flex-1 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
            >
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name} — ${p.price.toFixed(2)}
                </option>
              ))}
            </select>
            <button
              onClick={addItem}
              className="rounded-xl bg-coral px-3 py-2 text-sm font-medium text-white hover:bg-coral/80"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="min-h-[160px] space-y-2 rounded-xl border border-dashed border-sand-200 p-3">
            {items.length === 0 && (
              <p className="py-8 text-center text-sm text-cocoa-muted">No items added yet.</p>
            )}
            {items.map((item) => (
              <div
                key={item.productId}
                className="flex items-center justify-between gap-2 rounded-lg bg-sand-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-cocoa">
                    {item.emoji} {item.name}
                  </p>
                  <p className="text-xs text-cocoa-muted">${item.price.toFixed(2)} each</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => updateQty(item.productId, -1)}
                    className="rounded-md bg-white p-1 text-cocoa-muted shadow hover:bg-sand-100"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-5 text-center text-sm">{item.qty}</span>
                  <button
                    onClick={() => updateQty(item.productId, 1)}
                    className="rounded-md bg-white p-1 text-cocoa-muted shadow hover:bg-sand-100"
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    onClick={() => removeItem(item.productId)}
                    className="ml-1 rounded-md p-1 text-hibiscus hover:bg-hibiscus-light/10"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-sand-50 p-3 text-sm">
            <div className="flex justify-between text-cocoa-muted">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-cocoa-muted">
              <span>Discount</span>
              <input
                type="number"
                min={0}
                value={discount}
                onChange={(e) => setDiscount(Math.max(0, Number(e.target.value)))}
                className="w-20 rounded-md border border-sand-200 px-2 py-0.5 text-right outline-none focus:border-coral"
              />
            </div>
            <div className="mt-2 flex justify-between border-t border-sand-200 pt-2 text-base font-semibold text-cocoa">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-hibiscus-light/10 p-3 text-sm text-hibiscus">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={items.length === 0 || submitting}
            className="w-full rounded-xl bg-gradient-to-r from-mid-green to-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Creating..." : "Create Order"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
