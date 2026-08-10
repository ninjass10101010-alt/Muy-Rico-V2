import { useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import Modal from "./ui/Modal";
import ProductIcon from "./ProductIcon";
import { useStore } from "../context/StoreContext";
import { createPayment } from "../utils/api";
import { newId } from "../utils/format";
import type { OrderItem, OrderSource, PaymentMethod, PaymentStatus } from "../types";
import { PAYMENT_METHOD_LABELS, ONLINE_ONLY } from "../utils/format";

export default function OrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { products, customers, handleCreateCustomer, profile, apiCreateOrder, generateReceipt } = useStore();
  const [customerMode, setCustomerMode] = useState<"existing" | "new">("new");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState<OrderSource>("in-person");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [flavorSelections, setFlavorSelections] = useState<Record<string, string>>({});
  const [packPick, setPackPick] = useState("");
  const [productPick, setProductPick] = useState(products[0]?.id ?? "");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("paid");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [foodColoring, setFoodColoring] = useState("");
  const [language, setLanguage] = useState<"es" | "en">("es");

  // Show food coloring field when order has cupcakes, cakepops, or custom cake
  const COLORABLE_PRODUCTS = ['prod_cupcakes', 'prod_cakepop', 'prod_custom_cake'];
  const showColoringField = items.some(i => COLORABLE_PRODUCTS.includes(i.productId));

  const activeProducts = products.filter((p) => p.active);
  const pickedProduct = products.find((p) => p.id === productPick);
  const pickedFlavorGroups = pickedProduct?.flavor_groups ?? [];
  const pickedPacks = pickedProduct?.pack_sizes ?? [];
  const activePack = pickedPacks.find((pk) => pk.id === packPick) ?? pickedPacks[0] ?? null;
  const flavorsComplete = pickedFlavorGroups.every((g) => !!flavorSelections[g.name]);
  const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[])
    .filter((m) => profile.acceptedMethods[m] && !ONLINE_ONLY.includes(m));

  const subtotal = useMemo(() => items.reduce((sum, i) => sum + i.qty * i.price, 0), [items]);
  const total = Math.max(0, +(subtotal - discount).toFixed(2));

  const depositRequired = items.some((i) => i.productId.includes("cake")) || total >= 50;
  const depositAmount = +(total * 0.10).toFixed(2);
  const [collectDeposit, setCollectDeposit] = useState(true);

  function addItem() {
    const p = products.find((pr) => pr.id === productPick);
    if (!p) return;
    const groups = p.flavor_groups ?? [];
    if (groups.some((g) => !flavorSelections[g.name])) return; // all groups required
    const packNote = activePack ? ` (${activePack.label})` : "";
    const flavorNote = packNote + (groups.length
      ? ` (${groups.map((g) => `${g.name}: ${flavorSelections[g.name]}`).join(", ")})`
      : "");
    const packPrice = activePack ? Number(activePack.price) : p.price;
    const displayName = p.name + flavorNote;
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === p.id && (i.flavorNote || "") === flavorNote);
      if (existing) {
        return prev.map((i) =>
          i.productId === p.id && (i.flavorNote || "") === flavorNote ? { ...i, qty: i.qty + 1 } : i,
        );
      }
      return [...prev, { productId: p.id, name: displayName, emoji: p.emoji, qty: 1, price: packPrice, flavorNote }];
    });
    setFlavorSelections({});
    setPackPick("");
  }

  const itemKey = (i: OrderItem) => `${i.productId}|${i.flavorNote || ""}`;

  function updateQty(key: string, delta: number) {
    setItems((prev) =>
      prev
        .map((i) => (itemKey(i) === key ? { ...i, qty: Math.max(1, i.qty + delta) } : i))
        .filter(Boolean),
    );
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => itemKey(i) !== key));
  }

  function resetForm() {
    setCustomerMode("new");
    setCustomerId("");
    setCustomerName("");
    setPhone("");
    setEmail("");
    setSource("in-person");
    setItems([]);
    setPaymentMethod("cash");
    setPaymentStatus("paid");
    setDueDate(new Date().toISOString().slice(0, 10));
    setDiscount(0);
    setNotes("");
    setFoodColoring("");
    setLanguage("es");
    setFlavorSelections({});
  }

  async function handleSubmit() {
    if (items.length === 0 || submitting) return;
    setSubmitting(true);
    setErrorMsg("");

    try {
    let finalCustomerName = customerName;
    let finalPhone = phone;
    let customerIdForOrder: string | null = null;
    let newCustomer = null;

    if (customerMode === "existing") {
      const c = customers.find((cc) => cc.id === customerId);
      if (c) {
        finalCustomerName = c.name;
        finalPhone = c.phone;
        customerIdForOrder = c.id;
      }
    } else if (customerName.trim()) {
      newCustomer = {
        id: `cust_${Math.random().toString(36).slice(2, 9)}`,
        name: customerName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        notes: "",
        createdAt: new Date().toISOString(),
      };
      customerIdForOrder = newCustomer.id;
      finalCustomerName = newCustomer.name;
      finalPhone = newCustomer.phone;
    }

    // Create the customer record first so the order can be linked to it.
    if (newCustomer) {
      try {
        await handleCreateCustomer({
          id: newCustomer.id,
          name: newCustomer.name,
          phone: newCustomer.phone,
          email: newCustomer.email,
          notes: newCustomer.notes,
        });
      } catch (err) {
        console.error("Failed to create customer record:", err);
      }
    }

    // Determine effective payment status: deposit → partial
    const effectiveStatus: PaymentStatus = depositRequired && collectDeposit && paymentStatus === "paid"
      ? "partial"
      : paymentStatus;

    const result = await apiCreateOrder({
      customer_name: finalCustomerName || "Walk-in Customer",
      customer_id: customerIdForOrder,
      phone: finalPhone || null,
      email: email.trim() || null,
      pickup_date: dueDate,
      items_json: items.map((i) => ({ name: i.name, qty: i.qty, price: i.price, productId: i.productId })),
      total_cents: Math.round(total * 100),
      subtotal_cents: Math.round(subtotal * 100),
      discount_cents: Math.round(discount * 100),
      payment_method: paymentMethod,
      payment_status: effectiveStatus,
      notes: notes || null,
      source,
      food_coloring: foodColoring.trim() || null,
      language,
    });

    // Record the deposit payment if collecting one
    if (result?.id && depositRequired && collectDeposit && paymentMethod) {
      try {
        await createPayment({
          id: newId("pay"),
          orderId: result.id,
          orderNumber: null,
          customerName: finalCustomerName || "Walk-in Customer",
          amount: depositAmount,
          method: paymentMethod,
          date: new Date().toISOString(),
        });
      } catch (err) {
        console.error("Failed to record deposit payment:", err);
      }
    }

    if (result?.id && effectiveStatus === "paid") {
      generateReceipt(result.id).catch(() => {});
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
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Receipt language</label>
            <div className="flex gap-2">
              <button
                onClick={() => setLanguage("es")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${language === "es" ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted hover:border-sand-300"}`}
              >
                Español
              </button>
              <button
                onClick={() => setLanguage("en")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${language === "en" ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted hover:border-sand-300"}`}
              >
                English
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
                className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
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
                  className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
                />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (for receipt)"
                  className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
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
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Payment method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
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
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
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
                className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
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
              onChange={(e) => {
                setProductPick(e.target.value);
                setFlavorSelections({});
                setPackPick("");
              }}
              className="flex-1 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
            >
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.show_online === false ? "[Hidden] " : ""}{p.name} — ${(p.pack_sizes?.[0]?.price ?? p.price).toFixed(2)}
                </option>
              ))}
            </select>
            <button
              onClick={addItem}
              disabled={!flavorsComplete}
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
                  {pk.badge && <span className="mt-0.5 inline-block rounded bg-hibiscus px-1.5 py-0.5 text-[10px] font-bold text-white">{pk.badge}</span>}
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

          <div className="min-h-[160px] space-y-2 rounded-xl border border-dashed border-sand-200 p-3">
            {items.length === 0 && (
              <p className="py-8 text-center text-sm text-cocoa-muted">No items added yet.</p>
            )}
            {items.map((item) => (
              <div
                key={itemKey(item)}
                className="flex items-center justify-between gap-2 rounded-lg bg-sand-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-cocoa">
                    <ProductIcon emoji={item.emoji} imageUrl={products.find(p => p.id === item.productId)?.image_url} size={18} /> {item.name}
                  </p>
                  <p className="text-xs text-cocoa-muted">${item.price.toFixed(2)} each</p>
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
                  <button
                    onClick={() => removeItem(itemKey(item))}
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
                className="w-20 rounded-md border border-sand-200 px-2 py-0.5 text-right outline-none focus:border-palm"
              />
            </div>
            <div className="mt-2 flex justify-between border-t border-sand-200 pt-2 text-base font-semibold text-cocoa">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
            {depositRequired && (
              <div className="mt-2 rounded-lg border border-coral/30 bg-coral-light/10 p-2.5 text-xs text-cocoa">
                <div className="flex items-center justify-between">
                  <span className="font-medium">10% deposit required</span>
                  <span className="font-semibold text-coral">${depositAmount.toFixed(2)}</span>
                </div>
                <label className="mt-1.5 flex items-center gap-1.5 text-cocoa-muted">
                  <input
                    type="checkbox"
                    checked={collectDeposit}
                    onChange={(e) => setCollectDeposit(e.target.checked)}
                  />
                  Collect ${depositAmount.toFixed(2)} deposit now
                </label>
                {collectDeposit && paymentStatus === "paid" && (
                  <p className="mt-1 text-[10px] text-cocoa-muted/70">Order will be created as "partial" (deposit paid, balance due at pickup: ${(total - depositAmount).toFixed(2)})</p>
                )}
              </div>
            )}
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-hibiscus-light/10 p-3 text-sm text-hibiscus">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={items.length === 0 || submitting}
            className="w-full rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Creating..." : "Create Order"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
