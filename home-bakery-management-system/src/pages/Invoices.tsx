import { useMemo, useState } from "react";
import { Download, FileText, Plus, Printer, Send, Share2, Ban, Trash2 } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import InvoiceModal from "../components/InvoiceModal";
import { invoiceHtmlUrl, downloadInvoiceHtml, shareInvoice, invoicePayUrl } from "../utils/api";
import { buildInvoicePdf } from "../utils/invoicePdf";
import { formatCurrency, formatDate } from "../utils/format";
import type { Invoice, InvoiceStatus } from "../types";

const STATUS_TONE: Record<InvoiceStatus, string> = {
  draft: "bg-sand-200 text-cocoa/70",
  sent: "bg-blue-100 text-blue-700",
  converted: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-600",
};

const OPTION_LABEL: Record<Invoice["paymentOptions"], string> = {
  full: "Full only",
  deposit: "Deposit only",
  both: "Full or deposit",
};

export default function Invoices({ search }: { search: string }) {
  const { invoices, handleSendInvoice, handleVoidInvoice, handleDeleteInvoice } = useStore();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [detail, setDetail] = useState<Invoice | null>(null);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | "all">("all");
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (statusFilter !== "all" && inv.status !== statusFilter) return false;
      if (!q) return true;
      return (
        inv.number.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q) ||
        inv.email.toLowerCase().includes(q)
      );
    });
  }, [invoices, search, statusFilter]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const doSend = async (inv: Invoice) => {
    if (busy === inv.id) return;
    setBusy(inv.id);
    try {
      const r = await handleSendInvoice(inv.id);
      flash(r.status === "sent" ? `Sent ${inv.number}` : `Updated ${inv.number}`);
    } catch (e) {
      flash(String((e as Error).message || e));
    } finally {
      setBusy(null);
    }
  };

  const doVoid = async (inv: Invoice) => {
    if (!confirm(`Void ${inv.number}? The pay link will stop working.`)) return;
    setBusy(inv.id);
    try {
      await handleVoidInvoice(inv.id);
      flash(`Voided ${inv.number}`);
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (inv: Invoice) => {
    if (!confirm(`Delete draft ${inv.number}? This cannot be undone.`)) return;
    setBusy(inv.id);
    try {
      await handleDeleteInvoice(inv.id);
      flash(`Deleted ${inv.number}`);
    } finally {
      setBusy(null);
    }
  };

  const doShare = async (inv: Invoice) => {
    const result = await shareInvoice(inv);
    if (result === "copied") flash("Pay link copied to clipboard");
    else if (result === "failed") flash(invoicePayUrl(inv));
  };

  const doPdf = async (inv: Invoice) => {
    const bytes = await buildInvoicePdf(inv, inv.items);
    const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${inv.number}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-cocoa/60">Status</span>
          <select
            className="rounded-lg border border-sand-200 bg-white px-3 py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoiceStatus | "all")}
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="converted">Paid</option>
            <option value="void">Void</option>
          </select>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="flex items-center gap-1.5 rounded-lg bg-palm px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          <Plus size={16} /> New invoice
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-sand-300 p-10 text-center text-sm text-cocoa/50">
          <FileText size={24} className="mx-auto mb-2 opacity-50" />
          No invoices yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-sand-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-sand-50 text-left text-xs uppercase tracking-wide text-cocoa/50">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="border-t border-sand-100 hover:bg-sand-50/60">
                  <td className="px-4 py-3">
                    <button className="font-medium text-cocoa hover:text-coral" onClick={() => setDetail(inv)}>
                      {inv.number}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-cocoa">{inv.customerName}</div>
                    <div className="text-xs text-cocoa/50">{inv.email}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-cocoa/60">{OPTION_LABEL[inv.paymentOptions]}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatCurrency(inv.totalCents / 100)}
                    {inv.paidCents > 0 && inv.status !== "void" && (
                      <div className="text-xs text-green-600">
                        {inv.paidCents >= inv.totalCents ? "paid" : `paid ${formatCurrency(inv.paidCents / 100)}`}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[inv.status]}`}>
                      {inv.status === "converted" ? "Paid" : inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-cocoa/50">{formatDate(inv.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {inv.status !== "void" && (
                        <button title="Share pay link" aria-label="Share pay link" onClick={() => doShare(inv)} className="rounded-lg p-2 text-cocoa/60 hover:bg-sand-100 hover:text-coral">
                          <Share2 size={15} />
                        </button>
                      )}
                      <button title="Download PDF" aria-label="Download PDF" onClick={() => doPdf(inv)} className="rounded-lg p-2 text-cocoa/60 hover:bg-sand-100 hover:text-coral">
                        <Download size={15} />
                      </button>
                      <button title="Print / download HTML" aria-label="Print or download HTML" onClick={() => downloadInvoiceHtml(inv.id, inv.language)} className="rounded-lg p-2 text-cocoa/60 hover:bg-sand-100 hover:text-coral">
                        <Printer size={15} />
                      </button>
                      {(inv.status === "draft" || inv.status === "sent") && (
                        <button
                          title={inv.status === "sent" ? "Resend invoice email" : "Email invoice"}
                          aria-label={inv.status === "sent" ? "Resend invoice email" : "Email invoice"}
                          disabled={busy === inv.id}
                          onClick={() => doSend(inv)}
                          className="rounded-lg p-2 text-cocoa/60 hover:bg-sand-100 hover:text-coral disabled:opacity-40"
                        >
                          <Send size={15} />
                        </button>
                      )}
                      {inv.status !== "converted" && inv.status !== "void" && (
                        <button title="Void" aria-label="Void invoice" onClick={() => doVoid(inv)} className="rounded-lg p-2 text-cocoa/60 hover:bg-red-50 hover:text-red-600">
                          <Ban size={15} />
                        </button>
                      )}
                      {inv.status === "draft" && (
                        <button
                          title="Delete draft"
                          disabled={busy === inv.id}
                          onClick={() => doDelete(inv)}
                          className="rounded-lg p-2 text-cocoa/60 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-cocoa px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}

      <InvoiceModal open={modalOpen} onClose={() => setModalOpen(false)} invoice={editing} />

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? detail.number : ""}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-cocoa/50">Customer</span><div>{detail.customerName}</div></div>
              <div><span className="text-cocoa/50">Email</span><div>{detail.email}</div></div>
              <div><span className="text-cocoa/50">Issued</span><div>{formatDate(detail.issueDate)}</div></div>
              <div><span className="text-cocoa/50">Due</span><div>{detail.dueDate ? formatDate(detail.dueDate) : "—"}</div></div>
              <div><span className="text-cocoa/50">Payment options</span><div>{OPTION_LABEL[detail.paymentOptions]}</div></div>
              <div><span className="text-cocoa/50">Status</span><div>{detail.status === "converted" ? "Paid" : detail.status}</div></div>
              {detail.convertedOrderId != null && (
                <div><span className="text-cocoa/50">Order</span><div>#{detail.convertedOrderId}</div></div>
              )}
              {detail.paymentMethod && (
                <div><span className="text-cocoa/50">Paid via</span><div>{detail.paymentMethod}</div></div>
              )}
            </div>

            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-cocoa/50">
                <tr><th className="py-1">Description</th><th className="py-1 text-center">Qty</th><th className="py-1 text-right">Unit</th><th className="py-1 text-right">Amount</th></tr>
              </thead>
              <tbody>
                {detail.items.map((i) => (
                  <tr key={i.id} className="border-t border-sand-100">
                    <td className="py-1.5">{i.description}</td>
                    <td className="py-1.5 text-center">{i.qty}</td>
                    <td className="py-1.5 text-right">{formatCurrency(i.unit_price_cents / 100)}</td>
                    <td className="py-1.5 text-right">{formatCurrency((i.qty * i.unit_price_cents) / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between border-t border-sand-200 pt-3">
              <span className="font-medium">Total {formatCurrency(detail.totalCents / 100)}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditing(detail); setModalOpen(true); setDetail(null); }}
                  disabled={detail.status === "converted" || detail.status === "void"}
                  className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm transition hover:bg-sand-100 disabled:opacity-40"
                >
                  Edit
                </button>
                <button
                  onClick={() => window.open(invoiceHtmlUrl(detail.id, detail.language), "_blank", "noopener")}
                  className="rounded-lg border border-sand-200 px-3 py-1.5 text-sm transition hover:bg-sand-100"
                >
                  View
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
