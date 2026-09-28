import { useMemo, useState } from "react";
import { CreditCard, DollarSign, Smartphone } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { fetchPayments, restorePayment as restorePaymentRequest, type ApiPayment } from "../utils/api";
import { formatCurrency, formatDateTime, PAYMENT_METHOD_COLORS, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
import type { Payment, PaymentMethod } from "../types";

const METHOD_ICONS: Record<PaymentMethod, string> = {
  stripe: "💳",
  paypal: "🅿️",
  cashapp: "💵",
  venmo: "📲",
  applepay: "🍎",
  cash: "💰",
};

/**
 * The store's own `apiToPayment` is private to StoreContext, and the API row is
 * already camelCased by the server — only the id-ish fields need normalising.
 */
function apiToPaymentForRow(row: ApiPayment): Payment {
  return {
    id: row.id,
    orderId: row.orderId ? String(row.orderId) : "",
    orderNumber: row.orderNumber || "",
    customerName: row.customerName,
    amount: Number(row.amount) || 0,
    method: row.method,
    methodDetails: row.methodDetails || null,
    date: row.date,
    active: Boolean(row.active),
  };
}

export default function Payments({ search }: { search: string }) {
  const { payments, profile } = useStore();
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [showVoided, setShowVoided] = useState(false);
  const [voidedPayments, setVoidedPayments] = useState<Payment[]>([]);
  const [voidedBusy, setVoidedBusy] = useState(false);

  const readVoided = async () => {
    const rows = await fetchPayments(true);
    setVoidedPayments(rows.filter((p) => !p.active).map(apiToPaymentForRow));
  };

  const toggleVoided = async () => {
    const next = !showVoided;
    setShowVoided(next);
    if (!next) return;
    setVoidedBusy(true);
    try {
      await readVoided();
    } catch (err) {
      console.warn("Failed to fetch voided payments:", err);
    } finally {
      setVoidedBusy(false);
    }
  };

  const restorePayment = async (id: string) => {
    try {
      // Re-fetch after: the server re-derives the order's payment_status, so
      // the voided list can legitimately change beyond this row.
      await restorePaymentRequest(id);
      await readVoided();
    } catch (err) {
      console.warn("Failed to restore payment:", err);
    }
  };

  const totals = useMemo(() => {
    const map: Record<string, number> = {};
    payments.forEach((p) => (map[p.method] = (map[p.method] || 0) + p.amount));
    return map;
  }, [payments]);

  const grandTotal = payments.reduce((s, p) => s + p.amount, 0);

  const filtered = payments
    .filter((p) => (methodFilter === "all" ? true : p.method === methodFilter))
    .filter((p) => (search ? p.customerName.toLowerCase().includes(search.toLowerCase()) || p.orderNumber.toLowerCase().includes(search.toLowerCase()) : true))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const methods = Object.keys(profile.acceptedMethods) as PaymentMethod[];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-palm bg-palm p-4 text-white">
          <p className="flex items-center gap-1 text-xs text-sand-300">
            <DollarSign size={13} /> Total collected
          </p>
          <p className="mt-1 text-lg font-semibold">{formatCurrency(grandTotal)}</p>
        </div>
        {methods.map((m) => (
          <button
            key={m}
            onClick={() => setMethodFilter(methodFilter === m ? "all" : m)}
            className={`rounded-xl border p-4 text-left transition ${
              methodFilter === m ? "border-palm bg-sand-50" : "border-sand-200 bg-white hover:bg-sand-50"
            }`}
          >
            <p className="text-xs text-cocoa-muted">{METHOD_ICONS[m]} {PAYMENT_METHOD_LABELS[m]}</p>
            <p className="mt-1 text-lg font-semibold" style={{ color: PAYMENT_METHOD_COLORS[m] }}>
              {formatCurrency(totals[m] || 0)}
            </p>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50 text-left text-xs uppercase tracking-wide text-cocoa-muted">
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-sand-50">
                  <td className="px-4 py-3 font-medium text-cocoa">{p.orderNumber}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{p.customerName}</td>
                  <td className="px-4 py-3">
                    <div>
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                        style={{ backgroundColor: `${PAYMENT_METHOD_COLORS[p.method]}1A`, color: PAYMENT_METHOD_COLORS[p.method] }}
                      >
                        {METHOD_ICONS[p.method]} {PAYMENT_METHOD_LABELS[p.method]}
                      </span>
                      {p.methodDetails && formatPaymentSubMethod(p.methodDetails) && (
                        <div className="mt-0.5 text-xs text-cocoa-muted/60">{formatPaymentSubMethod(p.methodDetails)}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-cocoa-muted">{formatDateTime(p.date)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-cocoa">{formatCurrency(p.amount)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-cocoa-muted">
                    No payments recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-sand-200 bg-white shadow-sm">
        <button
          onClick={toggleVoided}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-semibold text-cocoa"
        >
          Voided payments
          <span className="text-xs font-normal text-cocoa-muted">
            {showVoided ? "Hide" : "Show"}
          </span>
        </button>
        {showVoided && (
          <div className="border-t border-sand-100 px-5 py-4">
            {voidedBusy && <p className="text-sm text-cocoa-muted">Loading…</p>}
            {!voidedBusy && voidedPayments.length === 0 && (
              <p className="text-sm text-cocoa-muted">No voided payments.</p>
            )}
            {!voidedBusy && voidedPayments.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 text-left text-xs uppercase tracking-wide text-cocoa-muted">
                    <th className="px-2 py-2">Customer</th>
                    <th className="px-2 py-2">Method</th>
                    <th className="px-2 py-2">Date</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100">
                  {voidedPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-2 py-2 text-cocoa-muted">{p.customerName}</td>
                      <td className="px-2 py-2 text-cocoa-muted">
                        {PAYMENT_METHOD_LABELS[p.method]}
                      </td>
                      <td className="px-2 py-2 text-cocoa-muted">{formatDateTime(p.date)}</td>
                      <td className="px-2 py-2 text-right text-cocoa-muted line-through">
                        {formatCurrency(p.amount)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => restorePayment(p.id)}
                          className="text-xs font-semibold text-palm hover:underline"
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cocoa">
          <CreditCard size={16} /> Accepted payment methods
        </h3>
        <div className="flex flex-wrap gap-2 text-sm text-cocoa-muted">
          {methods
            .filter((m) => profile.acceptedMethods[m])
            .map((m) => (
              <span key={m} className="flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1.5">
                {METHOD_ICONS[m]} {PAYMENT_METHOD_LABELS[m]}
              </span>
            ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-cocoa-muted">
          <Smartphone size={13} /> Manage connections & handles in Settings.
        </p>
      </div>
    </div>
  );
}
