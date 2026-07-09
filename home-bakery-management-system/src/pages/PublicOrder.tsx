import { useMemo, useState } from "react";
import { Minus, Plus, Trash2, CheckCircle } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { createOrder as apiCreateOrder } from "../utils/api";
import { PAYMENT_METHOD_LABELS } from "../utils/format";
import type { PaymentMethod } from "../types";

interface CartItem {
  productId: string;
  name: string;
  emoji: string;
  qty: number;
  price: number;
}

export default function PublicOrder() {
  const { products, profile } = useStore();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [pickupDate, setPickupDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [pickupTime, setPickupTime] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("venmo");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ id: number } | null>(null);
  const [error, setError] = useState("");

  const activeProducts = products.filter((p) => p.active);

  const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[]).filter(
    (m) => profile.acceptedMethods[m],
  );

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.qty * i.price, 0), [cart]);
  const total = subtotal;

  function addToCart(product: typeof activeProducts[0]) {
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      if (existing) {
        return prev.map((i) => (i.productId === product.id ? { ...i, qty: i.qty + 1 } : i));
      }
      return [...prev, { productId: product.id, name: product.name, emoji: product.emoji, qty: 1, price: product.price }];
    });
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) => (i.productId === productId ? { ...i, qty: Math.max(0, i.qty + delta) } : i))
        .filter((i) => i.qty > 0),
    );
  }

  function removeItem(productId: string) {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  }

  async function handleSubmit() {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (!pickupDate) { setError("Please select a pickup date."); return; }
    if (cart.length === 0) { setError("Please add at least one item."); return; }
    setError("");
    setSubmitting(true);

    try {
      const result = await apiCreateOrder({
        customer_name: name.trim(),
        phone: phone.trim() || null,
        pickup_date: pickupDate,
        pickup_time: pickupTime || null,
        items_json: cart.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
        total_cents: Math.round(total * 100),
        payment_method: paymentMethod,
        payment_status: "unpaid",
        notes: notes.trim() || null,
        source: "website",
      });
      setSuccess(result);
    } catch (err: any) {
      setError(err.message || "Failed to place order. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-sand-50 px-4 py-12">
        <div className="mx-auto max-w-lg text-center">
          <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-8 shadow-sm">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mid-green-light/20">
              <CheckCircle size={32} className="text-mid-green" />
            </div>
            <h2 className="font-serif text-2xl font-semibold text-cocoa">Order Placed!</h2>
            <p className="mt-2 text-sm text-cocoa-muted">
              Your order <strong>#{success.id}</strong> has been received.
            </p>
            <p className="mt-1 text-sm text-cocoa-muted">
              We'll get it ready for pickup. Thank you!
            </p>
            <button
              onClick={() => { setSuccess(null); setName(""); setPhone(""); setCart([]); setNotes(""); }}
              className="mt-6 rounded-xl bg-gradient-to-r from-mid-green to-palm px-6 py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
            >
              Place Another Order
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sand-50 px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="font-serif text-3xl font-bold text-cocoa">Muy Rico</h1>
          <p className="mt-1 text-sm text-cocoa-muted">Familia · Tradición · Sabor</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-hibiscus-light/30 bg-hibiscus-light/10 p-3 text-sm text-hibiscus">
            {error}
          </div>
        )}

        {/* Customer Info */}
        <div className="mb-4 rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-serif text-sm font-semibold text-cocoa">Your Info</h2>
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name *"
              className="input"
            />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number (optional)"
              type="tel"
              className="input"
            />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-cocoa-muted">Pickup date *</label>
                <input
                  type="date"
                  value={pickupDate}
                  onChange={(e) => setPickupDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-cocoa-muted">Pickup time</label>
                <input
                  type="time"
                  value={pickupTime}
                  onChange={(e) => setPickupTime(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Products Grid */}
        <div className="mb-4 rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-serif text-sm font-semibold text-cocoa">Our Menu</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {activeProducts.map((p) => {
              const inCart = cart.find((i) => i.productId === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className={`flex flex-col items-center gap-1.5 rounded-[24px] border p-3 text-center transition ${
                    inCart
                      ? "border-mid-green bg-mid-green-light/10 shadow-sm"
                      : "border-sand-200 bg-white hover:border-coral hover:shadow-sm"
                  }`}
                >
                  <span className="text-2xl">{p.emoji}</span>
                  <span className="text-xs font-semibold text-cocoa leading-tight">{p.name}</span>
                  <span className="text-xs text-cocoa-muted">${p.price.toFixed(2)}</span>
                  {inCart && (
                    <span className="rounded-full bg-mid-green px-2 py-0.5 text-[10px] font-bold text-white">
                      ×{inCart.qty}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cart */}
        {cart.length > 0 && (
          <div className="mb-4 rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-serif text-sm font-semibold text-cocoa">Your Order</h2>
            <div className="space-y-2">
              {cart.map((item) => (
                <div key={item.productId} className="flex items-center justify-between gap-2 rounded-lg bg-sand-50 px-3 py-2">
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
                    <span className="w-6 text-center text-sm font-medium">{item.qty}</span>
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
            <div className="mt-3 flex justify-between border-t border-sand-200 pt-3 text-base font-semibold text-cocoa">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>
        )}

        {/* Payment */}
        <div className="mb-4 rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-serif text-sm font-semibold text-cocoa">Payment Method</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {enabledMethods.map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={`rounded-xl border px-3 py-3 text-center text-sm font-medium transition ${
                  paymentMethod === m
                    ? "border-palm bg-palm text-white"
                    : "border-sand-200 text-cocoa-muted hover:border-sand-300"
                }`}
              >
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="mb-6 rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 font-serif text-sm font-semibold text-cocoa">Notes</h2>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Special instructions, allergies, decoration requests..."
            className="input"
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={cart.length === 0 || submitting}
          className="w-full rounded-xl bg-gradient-to-r from-mid-green to-palm py-3.5 text-base font-semibold text-white shadow-md transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Placing Order..." : `Place Order · $${total.toFixed(2)}`}
        </button>

        <p className="mt-4 text-center text-xs text-cocoa-muted">
          Hecho con amor · Holland, Michigan
        </p>
      </div>
    </div>
  );
}
