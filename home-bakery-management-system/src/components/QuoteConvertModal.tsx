import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import Modal from "./ui/Modal";
import { useStore } from "../context/StoreContext";
import { PAYMENT_METHOD_LABELS, ONLINE_ONLY } from "../utils/format";
import type { Quote, PaymentMethod } from "../types";

export default function QuoteConvertModal({
  quote,
  open,
  onClose,
  onDone,
}: {
  quote: Quote;
  open: boolean;
  onClose: () => void;
  onDone: (orderId: number) => void;
}) {
  const { profile, handleConvertQuote } = useStore();
  const [depositCents, setDepositCents] = useState(Math.ceil(0.5 * (quote.quotedPrice || 0)));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [done, setDone] = useState<{ orderId: number; paymentStatus: string } | null>(null);

  const quotedCents = quote.quotedPrice || 0;
  const minDeposit = Math.ceil(0.5 * quotedCents);
  const valid = depositCents >= minDeposit && depositCents <= quotedCents && paymentMethod;

  const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[]).filter(
    (m) => profile.acceptedMethods[m] && !ONLINE_ONLY.includes(m),
  );

  async function handleConvert() {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErrorMsg("");
    try {
      const result = await handleConvertQuote(quote.id, depositCents, paymentMethod);
      setDone({ orderId: result.orderId, paymentStatus: result.paymentStatus });
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to convert quote. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Convert Quote #${quote.id}`} wide>
      {!done ? (
        <div className="space-y-4">
          {/* Quote summary */}
          <div className="rounded-xl border border-sand-100 bg-sand-50 p-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-cocoa-muted">Customer</span>
              <span className="font-medium text-cocoa">{quote.customerName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cocoa-muted">Cake flavor</span>
              <span className="font-medium text-cocoa">{quote.cakeFlavor}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-cocoa-muted">Quoted price</span>
              <span className="font-semibold text-coral">{(quotedCents / 100).toFixed(2)}</span>
            </div>
          </div>

          {/* Deposit section */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">
              Minimum deposit (50%): ${(minDeposit / 100).toFixed(2)}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-cocoa-muted">$</span>
                <input
                  type="number"
                  step="0.01"
                  min={(minDeposit / 100).toFixed(2)}
                  max={(quotedCents / 100).toFixed(2)}
                  value={(depositCents / 100).toFixed(2)}
                  onChange={(e) => setDepositCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                  className="input pl-7"
                />
              </div>
              <button
                onClick={() => setDepositCents(quotedCents)}
                className={`btn-secondary whitespace-nowrap ${depositCents >= quotedCents ? "border-palm bg-palm/10 text-palm" : ""}`}
              >
                Pay in full
              </button>
            </div>
            {depositCents < minDeposit && (
              <p className="mt-1 text-xs text-hibiscus">
                Deposit must be at least 50% (${(minDeposit / 100).toFixed(2)})
              </p>
            )}
            {depositCents > quotedCents && (
              <p className="mt-1 text-xs text-hibiscus">
                Deposit cannot exceed quoted price (${(quotedCents / 100).toFixed(2)})
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Payment method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="input"
            >
              {enabledMethods.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>

          {errorMsg && (
            <p className="rounded-lg bg-hibiscus-light/10 px-3 py-2 text-xs text-hibiscus">{errorMsg}</p>
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button onClick={handleConvert} disabled={!valid || submitting} className="btn-primary flex-1">
              {submitting ? "Converting..." : "Convert to Order"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 py-4 text-center">
          <CheckCircle2 size={48} className="mx-auto text-mid-green" />
          <div>
            <p className="text-lg font-semibold text-cocoa">Order #{done.orderId} Created</p>
            <p className="text-sm text-cocoa-muted">
              {done.paymentStatus === "paid" ? "Full" : "Partial"} payment of ${(depositCents / 100).toFixed(2)} via{" "}
              {PAYMENT_METHOD_LABELS[paymentMethod]}.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onDone(done.orderId)}
              className="btn-primary flex-1"
            >
              View Order
            </button>
            <button onClick={onClose} className="btn-secondary flex-1">
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}