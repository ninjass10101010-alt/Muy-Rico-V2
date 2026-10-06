import { useCallback, useMemo, useState, Fragment } from "react";
import {
  MailCheck, MailX, Printer, RotateCw, Search, Share2,
  FileText, FileImage, ExternalLink, Send,
} from "lucide-react";
import { useStore } from "../context/StoreContext";
import { useToast } from "../components/ui/Toast";
import { formatCurrency, formatDateTime, formatDate, PAYMENT_METHOD_LABELS, formatPaymentSubMethod } from "../utils/format";
import { fetchOrderRaw } from "../utils/api";
import ReceiptExportHost, { type ReceiptExportTarget, type ReceiptExportAction } from "../components/receipt/ReceiptExportHost";
import { buildReceiptViewModel } from "../utils/receiptView";
import type { Receipt } from "../types";

export default function Receipts({ search }: { search: string }) {
  const { receipts, resendReceipt, missingReceipts } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<"history" | "missing">("history");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exportTarget, setExportTarget] = useState<ReceiptExportTarget | null>(null);
  const [langs, setLangs] = useState<Record<string, "en" | "es">>({});

  const runExport = useCallback(
    async (r: Receipt, action: ReceiptExportAction, win?: Window | null) => {
      setBusyId(r.id);
      try {
        const explicit = langs[r.id];
        const raw = await fetchOrderRaw(Number(r.orderId)).catch(() => null);
        const receiptLang = r.language === "en" || r.language === "es" ? r.language : null;
        const orderLang = raw?.order?.language === "en" || raw?.order?.language === "es" ? raw.order.language : null;
        const lang = explicit ?? receiptLang ?? orderLang ?? "es";
        const viewModel = buildReceiptViewModel(
          {
            receiptId: r.id,
            orderId: Number(r.orderId),
            orderNumber: r.orderNumber,
            customerName: r.customerName,
            itemsJson: r.itemsJson,
            totalCents: r.totalCents,
            paymentMethod: r.paymentMethod,
            paymentSubMethod: r.paymentSubMethod,
            orderStatus: r.orderStatus,
            language: r.language,
            createdAt: r.createdAt,
          },
          raw?.order ?? null,
          lang,
        );
        setExportTarget({
          viewModel,
          action,
          shareFormat: action === "share" ? "pdf" : undefined,
          win: win ?? null,
        });
      } catch (e) {
        setBusyId(null);
        toast.error(e instanceof Error ? e.message : "Could not prepare the receipt.");
      }
    },
    [langs, toast],
  );

  const finishExport = useCallback(() => {
    setBusyId(null);
    setExportTarget(null);
  }, []);
  const failExport = useCallback((message: string) => {
    setBusyId(null);
    setExportTarget(null);
    toast.error(message);
  }, [toast]);

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
      <div className="flex gap-1 rounded-xl border border-sand-200 bg-white p-1">
        <button
          onClick={() => setTab("history")}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] ${tab === "history" ? "bg-palm text-white" : "text-cocoa-muted hover:bg-sand-50"}`}
        >
          History
        </button>
        <button
          onClick={() => setTab("missing")}
          className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold min-h-[44px] ${tab === "missing" ? "bg-palm text-white" : "text-cocoa-muted hover:bg-sand-50"}`}
        >
          Missing receipts{missingReceipts.length ? ` (${missingReceipts.length})` : ""}
        </button>
      </div>

      {tab === "history" && (
        <>
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

                <div className="mt-3 grid grid-cols-4 gap-2">
                  <FileAction icon={<FileText size={16} />} label="PDF" busy={busyId === r.id} disabled={busyId !== null} onClick={() => void runExport(r, "download-pdf")} />
                  <FileAction icon={<FileImage size={16} />} label="PNG" busy={busyId === r.id} disabled={busyId !== null} onClick={() => void runExport(r, "download-png")} />
                  <FileAction icon={<Share2 size={16} />} label="Share" busy={busyId === r.id} disabled={busyId !== null} onClick={() => void runExport(r, "share")} />
                  <button
                    onClick={() => {
                      const win = window.open("", "_blank");
                      void runExport(r, "open", win);
                    }}
                    disabled={busyId !== null}
                    className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border border-sand-200 bg-sand-50 px-2 py-2 text-xs font-semibold text-cocoa hover:bg-sand-100 disabled:opacity-50"
                  >
                    <ExternalLink size={16} /> Open
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <LangToggle value={langs[r.id] ?? (r.language === "en" ? "en" : "es")} onChange={(v) => setLangs((m) => ({ ...m, [r.id]: v }))} />
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
                          <div className="flex flex-wrap items-center gap-1">
                            <LangToggle
                              compact
                              stopPropagation
                              value={langs[r.id] ?? (r.language === "en" ? "en" : "es")}
                              onChange={(v) => setLangs((m) => ({ ...m, [r.id]: v }))}
                            />
                            <button
                              onClick={(e) => { e.stopPropagation(); void runExport(r, "download-pdf"); }}
                              disabled={busyId !== null}
                              title="Download PDF"
                              className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-50 min-h-[36px]"
                            >
                              <FileText size={12} /> PDF
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void runExport(r, "download-png"); }}
                              disabled={busyId !== null}
                              title="Download PNG"
                              className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-50 min-h-[36px]"
                            >
                              <FileImage size={12} /> PNG
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void runExport(r, "share"); }}
                              disabled={busyId !== null}
                              title="Share PDF"
                              className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-50 min-h-[36px]"
                            >
                              <Share2 size={12} /> Share
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); void runExport(r, "print"); }}
                              disabled={busyId !== null}
                              title="Print"
                              className="inline-flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-2 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:opacity-50 min-h-[36px]"
                            >
                              <Printer size={12} /> Print
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
          <p className="text-center text-xs text-cocoa-muted/60 md:hidden">Tap a receipt to see details. Use PDF or PNG to save a file.</p>
        </>
      )}

      {tab === "missing" && <MissingTab search={search} />}

      <ReceiptExportHost target={exportTarget} onDone={finishExport} onError={failExport} />
    </div>
  );
}

function MissingTab({ search }: { search: string }) {
  const { missingReceipts, refreshMissingReceipts, sendMissingReceipts } = useStore();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [language, setLanguage] = useState<"auto" | "en" | "es">("auto");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return missingReceipts;
    return missingReceipts.filter(
      (m) =>
        m.customerName.toLowerCase().includes(q) ||
        (m.email || "").toLowerCase().includes(q) ||
        `MR-${m.id}`.toLowerCase().includes(q),
    );
  }, [missingReceipts, search]);

  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function send(ids: number[]) {
    if (!ids.length) return;
    setSending(true);
    let sent = 0, failed = 0, skipped = 0;
    const sentIds: number[] = [];
    try {
      for (let i = 0; i < ids.length; i += 10) {
        const chunk = ids.slice(i, i + 10);
        setProgress(`Sending ${Math.min(i + 10, ids.length)} of ${ids.length}…`);
        const result = await sendMissingReceipts(chunk, language);
        sent += result.sent; failed += result.failed; skipped += result.skipped;
        result.results.forEach((r) => { if (r.status === "sent") sentIds.push(r.id); });
      }
      const parts: string[] = [];
      if (sent > 0) parts.push(`Sent ${sent} receipt${sent === 1 ? "" : "s"}`);
      if (failed > 0) parts.push(`${failed} failed`);
      if (skipped > 0) parts.push(`${skipped} skipped`);
      const summary = parts.join(", ");
      if (failed + skipped > 0) toast.error(summary);
      else toast.success(summary);
      setSelected((prev) => new Set([...prev].filter((id) => !sentIds.includes(id))));
    } catch (e) {
      setSelected((prev) => new Set([...prev].filter((id) => !sentIds.includes(id))));
      const message = e instanceof Error ? e.message : "Sending receipts failed.";
      toast.error(sent > 0 ? `Sent ${sent} before the error. ${message}` : message);
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as "auto" | "en" | "es")}
          className="input min-h-[44px] max-w-[220px]"
          aria-label="Receipt language"
          disabled={sending}
        >
          <option value="auto">Auto (order language)</option>
          <option value="en">English</option>
          <option value="es">Español</option>
        </select>
        <button
          onClick={() => send([...selected])}
          disabled={sending || selected.size === 0}
          className="btn-primary min-h-[44px]"
        >
          <Send size={16} /> {sending ? progress || "Sending…" : `Send selected (${selected.size})`}
        </button>
        <button onClick={() => refreshMissingReceipts()} disabled={sending} className="btn-secondary min-h-[44px]">
          <RotateCw size={14} /> Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-sand-200 bg-white px-4 py-10 text-center text-cocoa-muted/70">
          {missingReceipts.length > 0
            ? "No missing receipts match your search."
            : "Every order with an email has a receipt."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white">
          <div className="flex items-center gap-3 border-b border-sand-100 px-4 py-3 text-xs font-semibold uppercase text-cocoa-muted/60">
            <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center">
              <input
                id="missing-select-all"
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map((m) => m.id)))}
                aria-label="Select all missing receipts"
                disabled={sending}
                className="h-4 w-4"
              />
            </label>
            <label htmlFor="missing-select-all" className="cursor-pointer">Select all</label>
          </div>
          <ul className="divide-y divide-sand-100">
            {filtered.map((m) => (
              <li
                key={m.id}
                className={`flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center ${
                  selected.has(m.id) ? "bg-palm-50/70" : ""
                }`}
              >
                <div className="flex w-full items-start gap-3 sm:flex-1 sm:items-center">
                  <label className="flex h-11 w-11 shrink-0 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      aria-label={`Select receipt for ${m.customerName}`}
                      disabled={sending}
                      className="h-4 w-4"
                    />
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium text-cocoa sm:truncate">
                      {m.customerName} <span className="text-cocoa-muted/60">· MR-{m.id}</span>
                    </p>
                    <p className="text-xs text-cocoa-muted [overflow-wrap:anywhere] sm:truncate sm:[overflow-wrap:normal]">{m.email}</p>
                  </div>
                </div>
                <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
                  <div className="text-right text-xs text-cocoa-muted">
                    <p className="font-semibold text-cocoa">{formatCurrency(m.totalCents / 100)}</p>
                    <p>{formatDate(m.pickupDate)}</p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      m.lastReceiptStatus === "failed"
                        ? "bg-hibiscus/10 text-hibiscus"
                        : "bg-sand-100 text-cocoa-muted"
                    }`}
                  >
                    {m.lastReceiptStatus === "failed"
                      ? "Failed"
                      : m.lastReceiptStatus === "printed"
                        ? "Print only"
                        : "Never sent"}
                  </span>
                  <button
                    onClick={() => send([m.id])}
                    disabled={sending}
                    aria-label={`Send receipt to ${m.customerName}`}
                    className="min-h-[44px] rounded-lg border border-sand-200 px-3 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50 disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FileAction({
  icon, label, onClick, busy, disabled,
}: { icon: React.ReactNode; label: string; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-xl border border-sand-200 bg-sand-50 px-2 py-2 text-xs font-semibold text-cocoa hover:bg-sand-100 disabled:opacity-50"
    >
      {icon} {busy ? "…" : label}
    </button>
  );
}

function LangToggle({
  value, onChange, compact, stopPropagation,
}: { value: "en" | "es"; onChange: (v: "en" | "es") => void; compact?: boolean; stopPropagation?: boolean }) {
  return (
    <div className={`flex items-center gap-0.5 rounded-lg border border-sand-200 overflow-hidden ${compact ? "" : "flex-1"}`}>
      {(["en", "es"] as const).map((l) => (
        <button
          key={l}
          onClick={(e) => { if (stopPropagation) e.stopPropagation(); onChange(l); }}
          className={`text-xs font-semibold uppercase ${
            compact ? "px-2.5 py-2 min-h-[36px]" : "flex-1 px-3 py-2.5 min-h-[44px]"
          } ${
            value === l ? "bg-palm text-white" : "text-cocoa-muted hover:bg-sand-50"
          }`}
        >
          {l}
        </button>
      ))}
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
