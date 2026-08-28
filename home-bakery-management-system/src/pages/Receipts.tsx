import { useMemo, useState, Fragment } from "react";
import { MailCheck, MailX, Printer, RotateCw, Search, Download, Share2, Eye } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { formatCurrency, formatDateTime, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
import { receiptHtmlUrl, downloadReceiptHtml, shareReceipt } from "../utils/api";
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

  function openReceipt(id: string, lang?: 'en' | 'es') {
    window.open(receiptHtmlUrl(id, lang), '_blank', 'noopener');
  }

  async function handleDownload(r: Receipt, lang?: 'en' | 'es') {
    // Use download helper - fetches HTML and triggers download for mobile
    await downloadReceiptHtml(r.id, lang);
  }

  async function handleShare(r: Receipt) {
    const shared = await shareReceipt(r.id);
    if (!shared) {
      // fallback to opening
      openReceipt(r.id);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Search size={16} className="text-cocoa-muted/50" />
        <span className="text-sm text-cocoa-muted">Filter by status:</span>
        {["all", "sent", "failed", "printed"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3.5 py-2 text-xs font-medium capitalize transition min-h-[36px] ${
              statusFilter === s ? "bg-palm text-white" : "bg-white text-cocoa-muted border border-sand-200 hover:bg-sand-50"
            }`}
          >
            {s === "printed" ? "Print Only" : s}
          </button>
        ))}
      </div>

      {/* Mobile cards - visible on small screens */}
      <div className="space-y-3 md:hidden">
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-sand-200 bg-white px-4 py-10 text-center text-cocoa-muted/50">
            No receipts found.
          </div>
        )}
        {filtered.map((r) => (
          <div key={r.id} className="rounded-2xl border border-sand-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-cocoa">{r.orderNumber}</p>
                <p className="text-sm text-cocoa-muted">{r.customerName}</p>
                <p className="text-xs text-cocoa-muted/70">{r.email || "No email"}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-cocoa">{formatCurrency(r.totalCents / 100)}</p>
                <p className="text-xs text-cocoa-muted">{formatDateTime(r.sentAt)}</p>
                <div className="mt-1 flex justify-end">
                  {r.status === "sent" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-mid-green/10 px-2 py-0.5 text-xs font-medium text-mid-green">
                      <MailCheck size={12} /> Sent
                    </span>
                  ) : r.status === "printed" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sand-200 px-2 py-0.5 text-xs font-medium text-cocoa-muted">
                      <Printer size={12} /> Print Only
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                      <MailX size={12} /> Failed
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-2 text-xs text-cocoa-muted">
              {PAYMENT_METHOD_LABELS[r.paymentMethod] || r.paymentMethod}
              {r.paymentSubMethod && formatPaymentSubMethod(r.paymentSubMethod) ? ` • ${formatPaymentSubMethod(r.paymentSubMethod)}` : ""}
            </div>

            {/* Primary actions - large touch targets */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                onClick={() => openReceipt(r.id)}
                className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border border-sand-200 bg-sand-50 px-2 py-2 text-xs font-semibold text-cocoa hover:bg-sand-100 active:bg-sand-200"
              >
                <Eye size={16} /> View / Print
              </button>
              <button
                onClick={() => handleDownload(r)}
                className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl bg-palm px-2 py-2 text-xs font-semibold text-white hover:bg-palm/90 active:bg-palm/80"
              >
                <Download size={16} /> Download
              </button>
              <button
                onClick={() => handleShare(r)}
                className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border border-sand-200 bg-white px-2 py-2 text-xs font-semibold text-cocoa hover:bg-sand-50 active:bg-sand-100"
              >
                <Share2 size={16} /> Share
              </button>
            </div>

            <div className="mt-2 flex gap-2">
              <button
                onClick={() => openReceipt(r.id, 'en')}
                className="flex-1 rounded-lg border border-sand-200 px-3 py-2.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50 min-h-[44px]"
              >
                EN
              </button>
              <button
                onClick={() => openReceipt(r.id, 'es')}
                className="flex-1 rounded-lg border border-sand-200 px-3 py-2.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50 min-h-[44px]"
              >
                ES
              </button>
              <button
                onClick={() => handleResend(r)}
                disabled={resending === r.id}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-sand-200 px-3 py-2.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50 disabled:opacity-50 min-h-[44px]"
              >
                <RotateCw size={12} className={resending === r.id ? "animate-spin" : ""} />
                Resend
              </button>
            </div>

            <button
              onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              className="mt-2 w-full text-center text-xs text-palm hover:underline py-2"
            >
              {expanded === r.id ? "Hide details" : "Show details"}
            </button>
            {expanded === r.id && (
              <div className="mt-2 rounded-xl bg-sand-50/70 p-3">
                <ReceiptDetail receipt={r} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table - hidden on mobile */}
      <div className="hidden md:block overflow-hidden rounded-2xl border border-sand-200 bg-white">
        <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
          <table className="w-full min-w-[760px] text-sm">
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
                      ) : r.status === "printed" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sand-200 px-2 py-0.5 text-xs font-medium text-cocoa-muted">
                          <Printer size={12} /> Print Only
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
                      <div className="flex gap-1">
                        <div className="flex items-center gap-0.5 rounded-lg border border-sand-200 overflow-hidden">
                          <button
                            onClick={(e) => { e.stopPropagation(); openReceipt(r.id, 'en'); }}
                            className="px-2.5 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 border-r border-sand-200 min-h-[36px]"
                          >EN</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); openReceipt(r.id, 'es'); }}
                            className="px-2.5 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 border-r border-sand-200 min-h-[36px]"
                          >ES</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); openReceipt(r.id); }}
                            className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 min-h-[36px]"
                          >
                            <Printer size={12} />
                            Print
                          </button>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(r); }}
                          title="Download to phone"
                          className="inline-flex items-center gap-1 rounded-lg border border-palm bg-palm px-2.5 py-2 text-xs font-medium text-white transition hover:bg-palm/90 min-h-[36px]"
                        >
                          <Download size={12} /> Download
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleResend(r); }}
                          disabled={resending === r.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-50 min-h-[36px]"
                        >
                          <RotateCw size={12} className={resending === r.id ? "animate-spin" : ""} />
                          Resend
                        </button>
                      </div>
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
      <p className="text-center text-xs text-cocoa-muted/60 md:hidden">Tap a receipt to see details. Use Download to save to your phone.</p>
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
