import { useMemo, useState } from "react";
import { CreditCard, DollarSign, Smartphone } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { formatCurrency, formatDateTime, PAYMENT_METHOD_COLORS, PAYMENT_METHOD_LABELS } from "../utils/format";
import type { PaymentMethod } from "../types";

const METHOD_ICONS: Record<PaymentMethod, string> = {
  stripe: "💳",
  cashapp: "💵",
  venmo: "📲",
  applepay: "🍎",
  cash: "💰",
};

export default function Payments({ search }: { search: string }) {
  const { payments, profile } = useStore();
  const [methodFilter, setMethodFilter] = useState<string>("all");

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
        <div className="rounded-[40px_12px_40px_12px] border border-palm bg-palm p-4 text-white">
          <p className="flex items-center gap-1 text-xs text-sand-300">
            <DollarSign size={13} /> Total collected
          </p>
          <p className="mt-1 text-lg font-semibold">{formatCurrency(grandTotal)}</p>
        </div>
        {methods.map((m) => (
          <button
            key={m}
            onClick={() => setMethodFilter(methodFilter === m ? "all" : m)}
            className={`rounded-[40px_12px_40px_12px] border p-4 text-left transition ${
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

      <div className="overflow-hidden rounded-[40px_12px_40px_12px] border border-sand-200 bg-white shadow-sm">
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
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                      style={{ backgroundColor: `${PAYMENT_METHOD_COLORS[p.method]}1A`, color: PAYMENT_METHOD_COLORS[p.method] }}
                    >
                      {METHOD_ICONS[p.method]} {PAYMENT_METHOD_LABELS[p.method]}
                    </span>
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

      <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
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
