import { useMemo, useState, Fragment } from "react";
import { MailCheck, MailX, RotateCw, Search } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { formatCurrency, formatDateTime, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
import type { Receipt } from "../types";

export default function Receipts({ search }: { search: string }) {
  const { receipts, resendReceipt } = useStore();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return receipts
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) =>
        search
          ? r.customerName.toLowerCase().includes(search.toLowerCase()) ||
            r.orderNumber.toLowerCase().includes(search.toLowerCase()) ||
            (r.email || "").toLowerCase().includes(search.toLowerCase())
          : true,
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [receipts, statusFilter, search]);

  async function handleResend(r: Receipt) {
    setResending(r.id);
    try {
      await resendReceipt(r.id);
    } finally {
      setResending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Search size={16} className="text-cocoa-muted/50" />
        <span className="text-sm text-cocoa-muted">Filter by status:</span>
        {["all", "sent", "failed"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition ${
              statusFilter === s ? "bg-palm text-white" : "bg-white text-cocoa-muted border border-sand-200 hover:bg-sand-50"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-sand-50 text-left text-xs uppercase text-cocoa-muted/60">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Payment</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Sent</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-cocoa-muted/50">
                  No receipts found.
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <Fragment key={r.id}>
                <tr
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="cursor-pointer hover:bg-sand-50"
                >
                  <td className="px-4 py-3 font-medium">{r.orderNumber}</td>
                  <td className="px-4 py-3">{r.customerName}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{r.email || "—"}</td>
                  <td className="px-4 py-3">
                    <div>{PAYMENT_METHOD_LABELS[r.paymentMethod] || r.paymentMethod}</div>
                    {r.paymentSubMethod && formatPaymentSubMethod(r.paymentSubMethod) && (
                      <div className="text-xs text-cocoa-muted/60">{formatPaymentSubMethod(r.paymentSubMethod)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.status === "sent" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-mid-green/10 px-2 py-0.5 text-xs font-medium text-mid-green">
                        <MailCheck size={12} /> Sent
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        <MailX size={12} /> Failed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{formatCurrency(r.totalCents / 100)}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{formatDateTime(r.sentAt)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleResend(r); }}
                      disabled={resending === r.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2 py-1 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-50"
                    >
                      <RotateCw size={12} className={resending === r.id ? "animate-spin" : ""} />
                      Resend
                    </button>
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr className="bg-sand-50/50">
                    <td colSpan={8} className="px-4 py-4">
                      <ReceiptDetail receipt={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReceiptDetail({ receipt }: { receipt: Receipt }) {
  let items: { name: string; qty: number; price: number }[] = [];
  try {
    items = JSON.parse(receipt.itemsJson);
  } catch { /* ignore */ }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-4">
        <div><span className="text-cocoa-muted/60">Order status: </span>{receipt.orderStatus}</div>
        <div><span className="text-cocoa-muted/60">Message ID: </span>{receipt.messageId || "—"}</div>
        <div><span className="text-cocoa-muted/60">Created: </span>{formatDateTime(receipt.createdAt)}</div>
        <div><span className="text-cocoa-muted/60">Total: </span>{formatCurrency(receipt.totalCents / 100)}</div>
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase text-cocoa-muted/60">Items</p>
        <ul className="space-y-0.5 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex justify-between">
              <span>{it.qty} × {it.name}</span>
              <span className="text-cocoa-muted">{formatCurrency(it.qty * it.price)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
