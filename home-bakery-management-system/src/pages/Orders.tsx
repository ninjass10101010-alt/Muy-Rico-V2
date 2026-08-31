import { useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Tag, Trash2, Wallet } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Badge from "../components/ui/Badge";
import ProductIcon from "../components/ProductIcon";
import Modal from "../components/ui/Modal";
import EditOrderModal from "../components/EditOrderModal";
import { formatCurrency, formatDate, formatDateTime, PAYMENT_METHOD_LABELS, ONLINE_ONLY, formatPaymentSubMethod, dueTier, urgencyRank, DUE_TIER_LABELS } from "../utils/format";
import { generateOrderLabels, receiptHtmlUrl, fetchOrder } from "../utils/api";
import type { ApiOrderEvent } from "../utils/api";
import type { Order, OrderStatus, PaymentMethod } from "../types";
import type { Page } from "../App";

const STATUS_FLOW: OrderStatus[] = ["pending", "in-progress", "ready", "completed", "cancelled"];

export default function Orders({ search, setPage, setLabelFilter }: {
  search: string;
  setPage: (p: Page) => void;
  setLabelFilter: (filter: string | null) => void;
}) {
  const { orders, products, payments, customers, apiDeductInventory, recordPayment, profile, apiUpdateOrder, apiCancelOrder, apiDeleteOrder, handleRelinkOrder, refreshOrders, refreshPayments, refreshLabelTemplates, receipts, resendReceipt, generateReceipt } = useStore();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Order | null>(null);
  const [payFor, setPayFor] = useState<Order | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");
  const [markPayFor, setMarkPayFor] = useState<Order | null>(null);
  const [markPayMethod, setMarkPayMethod] = useState<PaymentMethod>("cash");
  const [editPayFor, setEditPayFor] = useState<Order | null>(null);
  const [editPayMethod, setEditPayMethod] = useState<PaymentMethod>("cash");
  const [editPaySub, setEditPaySub] = useState("");
  const [generatingLabels, setGeneratingLabels] = useState(false);
  const [labelGenResult, setLabelGenResult] = useState<string | null>(null);
  const [relinkOrderId, setRelinkOrderId] = useState<string | null>(null);
  const [relinkSearch, setRelinkSearch] = useState("");
  const [orderEvents, setOrderEvents] = useState<ApiOrderEvent[]>([]);
  const [dueEdit, setDueEdit] = useState<string | null>(null);
  const [dueError, setDueError] = useState<string | null>(null);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const eventsFetchId = useRef<number | null>(null);

  const filtered = useMemo(() => {
    return orders
      .filter((o) => (statusFilter === "all" ? true : o.status === statusFilter))
      .filter((o) => (sourceFilter === "all" ? true : o.source === sourceFilter))
      .filter((o) =>
        search
          ? o.customerName.toLowerCase().includes(search.toLowerCase()) ||
            o.orderNumber.toLowerCase().includes(search.toLowerCase())
          : true,
      )
      .sort((a, b) => urgencyRank(a) - urgencyRank(b));
  }, [orders, statusFilter, sourceFilter, search]);

  async function updateStatus(order: Order, status: OrderStatus) {
    try {
      await apiUpdateOrder(Number(order.id), { status });
      if (status === "completed" && !order.inventoryDeducted) {
        await apiDeductInventory(Number(order.id));
      }
    } catch (err) {
      console.error("Failed to update order:", err);
    }
  }

  async function saveDueDate() {
    if (!selected || !dueEdit) return;
    try {
      await apiUpdateOrder(Number(selected.id), { pickup_date: dueEdit });
      setDueError(null);
      await refreshOrders();
      setSelected((prev) => (prev && prev.id === selected.id ? { ...prev, dueDate: dueEdit } : prev));
      setDueEdit(null);
      eventsFetchId.current = Number(selected.id);
      fetchOrder(Number(selected.id)).then((r) => {
        if (eventsFetchId.current !== Number(selected.id)) return;
        setOrderEvents(r.events);
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setDueError(
        msg.includes("past")
          ? "Pickup date cannot be in the past."
          : "Could not save the date. Please try again."
      );
      setDueEdit(null);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Permanently delete this order? This cannot be undone.")) return;
    try {
      await apiDeleteOrder(Number(id));
      setSelected(null);
    } catch (err) {
      console.error("Failed to delete order:", err);
      alert("Failed to delete order. Please try again.");
    }
  }

  const [receiptMsg, setReceiptMsg] = useState("");

  async function confirmPayment() {
    if (!payFor) return;
    const updated: Order = { ...payFor, paymentStatus: "paid", paymentMethod: payMethod };
    await apiUpdateOrder(Number(payFor.id), { payment_status: "paid", payment_method: payMethod });
    await recordPayment(updated);
    setPayFor(null);
    setReceiptMsg("");
    try {
      await generateReceipt(Number(payFor.id));
      setReceiptMsg("Receipt created successfully.");
    } catch (err) {
      console.error("Receipt generation failed:", err);
      setReceiptMsg("Receipt generation failed. Check console for details.");
    }
    await refreshOrders();
  }

  const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[]).filter(
    (m) => profile.acceptedMethods[m] && !ONLINE_ONLY.includes(m),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={["all", ...STATUS_FLOW, "awaiting_payment"]}
          label="Status"
        />
        <FilterSelect
          value={sourceFilter}
          onChange={setSourceFilter}
          options={["all", "website", "in-person"]}
          label="Source"
        />
        <span className="ml-auto text-sm text-cocoa-muted">{filtered.length} orders</span>
      </div>

      {receiptMsg && (
        <div className={`rounded-xl p-3 text-sm ${receiptMsg.includes("failed") ? "bg-hibiscus-light/10 text-hibiscus" : "bg-mid-green-light/10 text-mid-green"}`}>
          {receiptMsg}
          <button onClick={() => setReceiptMsg("")} className="ml-2 text-xs underline">Dismiss</button>
        </div>
      )}

      {(() => {
        const active = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
        const overdue = active.filter((o) => dueTier(o.dueDate, o.status) === "overdue").length;
        const today = active.filter((o) => dueTier(o.dueDate, o.status) === "today").length;
        const unpaid = active.filter((o) => o.paymentStatus === "unpaid").length;
        if (!overdue && !today && !unpaid) return null;
        return (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-cocoa-muted">Needs attention:</span>
            {overdue > 0 && (
              <button
                onClick={() => setStatusFilter("all")}
                className="rounded-full bg-hibiscus/10 px-2.5 py-1 font-semibold text-hibiscus ring-1 ring-inset ring-hibiscus/30 transition hover:bg-hibiscus/20"
              >
                {overdue} Overdue
              </button>
            )}
            {unpaid > 0 && (
              <button
                onClick={() => setStatusFilter("awaiting_payment")}
                className="rounded-full bg-coral-light/30 px-2.5 py-1 font-semibold text-coral ring-1 ring-inset ring-coral/30 transition hover:bg-coral-light/40"
              >
                {unpaid} Unpaid
              </button>
            )}
            {today > 0 && (
              <button
                onClick={() => setStatusFilter("all")}
                className="rounded-full bg-coral-light/20 px-2.5 py-1 font-semibold text-coral ring-1 ring-inset ring-coral/20 transition hover:bg-coral-light/30"
              >
                {today} Due Today
              </button>
            )}
          </div>
        );
      })()}

      <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50 text-left text-xs uppercase tracking-wide text-cocoa-muted">
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {filtered.map((o) => {
                const tier = dueTier(o.dueDate, o.status);
                const borderColor =
                  tier === "overdue" ? "#c0573a" :
                  tier === "today" ? "#f7a8a4" :
                  tier === "tomorrow" ? "#fad9d4" :
                  "transparent";
                return (
                <tr key={o.id} className="cursor-pointer hover:bg-sand-50" style={{ borderLeft: `3px solid ${borderColor}` }} onClick={() => { setSelected(o); setLabelGenResult(null); setDueEdit(null); setDueError(null); setOrderEvents([]); eventsFetchId.current = Number(o.id); fetchOrder(Number(o.id)).then((r) => { if (eventsFetchId.current !== Number(o.id)) return; setOrderEvents(r.events); }).catch(() => {}); }}>
                  <td className="px-4 py-3 font-medium text-cocoa">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{o.customerName}</td>
                  <td className="px-4 py-3">
                    <Badge tone={o.source}>{o.source}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {tier === "overdue" || tier === "today" || tier === "tomorrow" || tier === "this-week" ? (
                      <Badge tone={tier}>
                        {tier === "this-week" ? formatDate(o.dueDate) : DUE_TIER_LABELS[tier]}
                      </Badge>
                    ) : (
                      <span className="text-cocoa-muted">{formatDate(o.dueDate)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {o.paymentStatus === "paid" ? (
                        <CheckCircle2 size={14} className="text-mid-green" />
                      ) : o.paymentStatus === "partial" ? (
                        <Wallet size={14} className="text-coral" />
                      ) : (
                        <AlertCircle size={14} className="text-hibiscus" />
                      )}
                      <Badge tone={o.paymentStatus}>
                        {o.paymentStatus === "paid" && o.paymentMethod
                          ? PAYMENT_METHOD_LABELS[o.paymentMethod]
                          : o.paymentStatus}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={o.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateStatus(o, e.target.value as OrderStatus)}
                      className="rounded-lg border border-sand-200 bg-white px-2 py-1 text-xs capitalize outline-none focus:border-palm"
                    >
                      {STATUS_FLOW.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-cocoa">{formatCurrency(o.total)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {o.paymentStatus !== "paid" && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPayFor(o);
                            setPayMethod(o.paymentMethod || "cash");
                          }}
                          className="rounded-lg p-1.5 text-mid-green hover:bg-mid-green-light/10"
                          title="Record payment"
                        >
                          <Wallet size={16} />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(o.id);
                        }}
                        className="rounded-lg p-1.5 text-hibiscus hover:bg-hibiscus-light/10"
                        title="Delete order"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-cocoa-muted">
                    No orders match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!selected} onClose={() => { setSelected(null); setLabelGenResult(null); setRelinkOrderId(null); setRelinkSearch(""); }} title={selected ? `Order ${selected.orderNumber}` : ""}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-cocoa">{selected.customerName}</p>
                <p className="text-xs text-cocoa-muted">{selected.phone}</p>
                {relinkOrderId === selected.id ? (
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="text"
                      value={relinkSearch}
                      onChange={(e) => setRelinkSearch(e.target.value)}
                      placeholder="Search customer..."
                      className="input text-xs"
                      autoFocus
                    />
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          handleRelinkOrder(Number(selected.id), e.target.value);
                          setRelinkOrderId(null);
                          setRelinkSearch("");
                        }
                      }}
                      className="input text-xs"
                    >
                      <option value="">Select...</option>
                      {customers
                        .filter((c) => c.name.toLowerCase().includes(relinkSearch.toLowerCase()))
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                    <button
                      onClick={() => { setRelinkOrderId(null); setRelinkSearch(""); }}
                      className="text-xs text-cocoa-muted hover:text-cocoa"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setRelinkOrderId(selected.id)}
                    className="text-xs text-palm hover:underline"
                  >
                    Change
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => { setEditOrder(selected); setSelected(null); }}
                  className="rounded-lg border border-sand-200 px-2.5 py-1 text-xs font-semibold text-cocoa transition hover:bg-sand-50"
                >
                  Edit
                </button>
                <Badge tone={selected.source}>{selected.source}</Badge>
                <Badge tone={selected.status}>{selected.status}</Badge>
              </div>
            </div>
            <div className="divide-y divide-sand-100 rounded-xl border border-sand-100">
              {selected.items.map((i) => {
                const img = products.find((p) => p.id === i.productId)?.image_url;
                return (
                <div key={i.productId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="flex items-center gap-1.5">
                    <ProductIcon emoji={i.emoji} imageUrl={img} size={18} /> {i.name} × {i.qty}
                  </span>
                  <span className="font-medium">{formatCurrency(i.qty * i.price)}</span>
                </div>
                );
              })}
            </div>
            <div className="space-y-1 rounded-xl bg-sand-50 p-3 text-sm">
              <div className="flex justify-between text-cocoa-muted">
                <span>Subtotal</span>
                <span>{formatCurrency(selected.subtotal)}</span>
              </div>
              {selected.discount > 0 && (
                <div className="flex justify-between text-cocoa-muted">
                  <span>Discount</span>
                  <span>-{formatCurrency(selected.discount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-sand-200 pt-1 font-semibold text-cocoa">
                <span>Total</span>
                <span>{formatCurrency(selected.total)}</span>
              </div>
            </div>
            {selected.notes && (
              <div className="rounded-xl bg-coral-light/20 p-3 text-sm text-cocoa">{selected.notes}</div>
            )}
            {selected.foodColoring && (
              <div className="flex items-center gap-1.5 rounded-xl bg-violet-100 p-3 text-sm font-medium text-violet-800">
                <span>🎨 Food coloring:</span>
                <span>{selected.foodColoring}</span>
              </div>
            )}
            {/* Payment panel */}
            <div className="rounded-xl border border-sand-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-cocoa-muted/60">Payment</span>
                <Badge tone={selected.paymentStatus}>{selected.paymentStatus}</Badge>
              </div>
              {selected.paymentStatus === "paid" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-cocoa">
                      {selected.paymentMethod ? PAYMENT_METHOD_LABELS[selected.paymentMethod] : "Paid"}
                      {selected.paymentSubMethod && formatPaymentSubMethod(selected.paymentSubMethod) && (
                        <span className="ml-1 text-cocoa-muted/60">({formatPaymentSubMethod(selected.paymentSubMethod)})</span>
                      )}
                    </span>
                    <div className="flex gap-3">
                      <button
                        onClick={() => { setEditPayFor(selected); setEditPayMethod(selected.paymentMethod || "cash"); setEditPaySub(selected.paymentSubMethod || ""); }}
                        className="text-xs font-semibold text-coral hover:underline"
                      >
                        Edit method
                      </button>
                       <button
                        onClick={async () => {
                          if (!window.confirm("Mark this order as unpaid? The payment history will be kept for your records.")) return;
                          await apiUpdateOrder(Number(selected.id), { payment_status: "unpaid" });
                          await Promise.all([refreshOrders(), refreshPayments()]);
                          setSelected(null);
                        }}
                        className="text-xs font-semibold text-hibiscus hover:underline"
                      >
                        Undo payment
                      </button>
                    </div>
                  </div>
                </div>
              ) : selected.paymentStatus === "partial" ? (
                <div className="space-y-2">
                  {(() => {
                    const totalPaid = payments
                      .filter((p) => p.orderId === selected.id)
                      .reduce((sum, p) => sum + p.amount, 0);
                    const remaining = Math.max(0, selected.total - totalPaid);
                    return (
                      <>
                        <div className="flex justify-between text-sm">
                          <span className="text-cocoa-muted">Deposit paid</span>
                          <span className="font-medium text-mid-green">{formatCurrency(totalPaid)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-cocoa-muted">Remaining balance</span>
                          <span className="font-semibold text-cocoa">{formatCurrency(remaining)}</span>
                        </div>
                      </>
                    );
                  })()}
                  {markPayFor?.id === selected.id ? (
                    <div className="space-y-2">
                      <select
                        value={markPayMethod}
                        onChange={(e) => setMarkPayMethod(e.target.value as PaymentMethod)}
                        className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
                      >
                        {enabledMethods.map((m) => (
                          <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            const totalPaid = payments
                              .filter((p) => p.orderId === selected.id)
                              .reduce((sum, p) => sum + p.amount, 0);
                            const remaining = Math.max(0, selected.total - totalPaid);
                            await apiUpdateOrder(Number(selected.id), { payment_status: "paid", payment_method: markPayMethod });
                            await recordPayment({ ...selected, paymentStatus: "paid", paymentMethod: markPayMethod, total: remaining } as Order);
                            setReceiptMsg("");
                            try {
                              await generateReceipt(Number(selected.id));
                              setReceiptMsg("Receipt created successfully.");
                            } catch (err) {
                              console.error("Receipt generation failed:", err);
                              setReceiptMsg("Receipt generation failed.");
                            }
                            setMarkPayFor(null);
                            setSelected(null);
                            await refreshOrders();
                          }}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
                        >
                          <CheckCircle2 size={16} /> Collect Balance
                        </button>
                        <button
                          onClick={() => setMarkPayFor(null)}
                          className="rounded-xl border border-sand-200 px-4 py-2.5 text-sm text-cocoa-muted hover:bg-sand-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setMarkPayFor(selected); setMarkPayMethod(selected.paymentMethod || "cash"); }}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
                    >
                      <CheckCircle2 size={16} /> Collect Balance
                    </button>
                  )}
                  <button
                    onClick={async () => {
                      if (!window.confirm("Mark this order as unpaid? The payment history will be kept for your records.")) return;
                      await apiUpdateOrder(Number(selected.id), { payment_status: "unpaid" });
                      await Promise.all([refreshOrders(), refreshPayments()]);
                      setSelected(null);
                    }}
                    className="text-xs font-semibold text-hibiscus hover:underline"
                  >
                    Undo payment
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-cocoa-muted">This order is unpaid. Mark it as paid once you collect payment.</p>
                  {markPayFor?.id === selected.id ? (
                    <div className="space-y-2">
                      <select
                        value={markPayMethod}
                        onChange={(e) => setMarkPayMethod(e.target.value as PaymentMethod)}
                        className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
                      >
                        {enabledMethods.map((m) => (
                          <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            await apiUpdateOrder(Number(selected.id), { payment_status: "paid", payment_method: markPayMethod });
                            await recordPayment({ ...selected, paymentStatus: "paid", paymentMethod: markPayMethod });
                            setReceiptMsg("");
                            try {
                              await generateReceipt(Number(selected.id));
                              setReceiptMsg("Receipt created successfully.");
                            } catch (err) {
                              console.error("Receipt generation failed:", err);
                              setReceiptMsg("Receipt generation failed.");
                            }
                            setMarkPayFor(null);
                            setSelected(null);
                            await refreshOrders();
                          }}
                          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
                        >
                          <CheckCircle2 size={16} /> Confirm Payment
                        </button>
                        <button
                          onClick={() => setMarkPayFor(null)}
                          className="rounded-xl border border-sand-200 px-4 py-2.5 text-sm text-cocoa-muted hover:bg-sand-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setMarkPayFor(selected); setMarkPayMethod(selected.paymentMethod || "cash"); }}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
                    >
                      <CheckCircle2 size={16} /> Mark as Paid
                    </button>
                  )}
                </div>
              )}
              {/* Payment history */}
              {payments.filter((p) => p.orderId === selected.id).length > 0 && (
                <div className="border-t border-sand-100 pt-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase text-cocoa-muted/50">Payment history</p>
                  {payments
                    .filter((p) => p.orderId === selected.id)
                    .map((p) => (
                      <div key={p.id} className="flex justify-between text-xs text-cocoa-muted">
                        <span>{PAYMENT_METHOD_LABELS[p.method] || p.method}{p.methodDetails ? ` (${p.methodDetails})` : ""}</span>
                        <span>{formatCurrency(p.amount)} &middot; {formatDate(p.date)}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
            <div className="border-t border-sand-200 pt-3">
              <p className="mb-2 text-xs font-semibold uppercase text-cocoa-muted/60">Receipts</p>
              {receipts.filter((r) => r.orderId === selected.id).length === 0 ? (
                <p className="text-sm text-cocoa-muted/50">No receipts sent for this order.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {receipts
                    .filter((r) => r.orderId === selected.id)
                    .map((r) => (
                      <li key={r.id} className="flex items-center justify-between">
                        <span>
                          {r.status === "sent" ? "✓" : r.status === "printed" ? "🖨" : "✗"} {formatDateTime(r.sentAt)}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => window.open(receiptHtmlUrl(r.id))}
                            className="text-xs text-cocoa-muted hover:underline"
                          >
                            Print
                          </button>
                          <button
                            onClick={() => resendReceipt(r.id)}
                            className="text-xs text-coral hover:underline"
                          >
                            Resend
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
            {orderEvents.length > 0 && (
              <div className="space-y-1 rounded-xl border border-sand-100 p-3">
                <p className="text-xs font-semibold uppercase text-cocoa-muted/60">History</p>
                <ul className="space-y-1">
                  {orderEvents.slice(-8).reverse().map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-2 text-xs text-cocoa-muted">
                      <span className="break-all">{e.event}</span>
                      <span className="shrink-0">{formatDateTime(e.created_at)}{e.actor ? ` · ${e.actor}` : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-cocoa-muted">
                <span>Ordered {formatDate(selected.createdAt)}</span>
                <span className="flex items-center gap-1.5">
                  Due{" "}
                  {selected.status === "cancelled" ? (
                    formatDate(selected.dueDate)
                  ) : (
                    <input
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={dueEdit ?? selected.dueDate.slice(0, 10)}
                      onChange={(e) => { setDueEdit(e.target.value); setDueError(null); }}
                      className="input text-xs"
                    />
                  )}
                  {dueEdit !== null && dueEdit !== "" && dueEdit !== selected.dueDate.slice(0, 10) && (
                    <button onClick={saveDueDate} className="text-xs font-semibold text-palm hover:underline">
                      Save
                    </button>
                  )}
                </span>
              </div>
              {dueError && <p className="text-xs text-hibiscus">{dueError}</p>}
            </div>
            <button
              onClick={() => {
                setLabelFilter(String(selected.id));
                setPage("labels");
                setSelected(null);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-coral/40 bg-coral/5 py-2.5 text-sm font-semibold text-coral transition hover:bg-coral/10"
            >
              <Tag size={15} />
              View Labels for {selected.orderNumber}
            </button>
            <button
              disabled={generatingLabels}
              onClick={async () => {
                setGeneratingLabels(true);
                setLabelGenResult(null);
                try {
                  const result = await generateOrderLabels(Number(selected.id));
                  const count = result.generated || 0;
                  setLabelGenResult(
                    count > 0
                      ? `${count} label${count !== 1 ? 's' : ''} generated! Click "View Labels" to open them.`
                      : "No labels generated — all items already have labels or no matching products found."
                  );
                  await refreshOrders();
                  await refreshLabelTemplates();
                } catch {
                  setLabelGenResult("Could not generate labels — try again.");
                } finally {
                  setGeneratingLabels(false);
                }
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-sand-200 bg-sand-50 py-2.5 text-sm font-semibold text-cocoa-muted transition hover:bg-sand-100 disabled:opacity-50"
            >
              {generatingLabels ? "Generating..." : "🔄 (Re)Generate Labels"}
            </button>
            {labelGenResult && (
              <p className="text-center text-xs text-mid-green">{labelGenResult}</p>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title="Record Payment">
        {payFor && (
          <div className="space-y-4">
            <p className="text-sm text-cocoa-muted">
              Confirm how <span className="font-medium text-cocoa">{payFor.customerName}</span> paid for order{" "}
              {payFor.orderNumber} ({formatCurrency(payFor.total)}).
            </p>
            <select
              value={payMethod}
              onChange={(e) => setPayMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
            >
              {enabledMethods.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            <button
              onClick={confirmPayment}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
            >
              <CheckCircle2 size={16} /> Mark as Paid
            </button>
          </div>
        )}
      </Modal>

      <Modal open={!!editPayFor} onClose={() => setEditPayFor(null)} title="Edit Payment Method">
        {editPayFor && (
          <div className="space-y-4">
            <p className="text-sm text-cocoa-muted">
              Correct how order {editPayFor.orderNumber} was paid. Records only; does not charge or refund. Already-sent receipts are not resent.
            </p>
            <select
              value={editPayMethod}
              onChange={(e) => setEditPayMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
            >
              {enabledMethods.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            <input
              value={editPaySub}
              onChange={(e) => setEditPaySub(e.target.value)}
              placeholder="Sub-method (optional, e.g. card brand or handle)"
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
            />
            <button
              onClick={async () => {
                await apiUpdateOrder(Number(editPayFor.id), { payment_method: editPayMethod, payment_sub_method: editPaySub.trim() || null });
                await refreshOrders();
                setEditPayFor(null);
                setSelected(null);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
            >
              <CheckCircle2 size={16} /> Save Payment Method
            </button>
          </div>
        )}
      </Modal>

      <EditOrderModal
        open={!!editOrder}
        order={editOrder}
        onClose={() => setEditOrder(null)}
        onSaved={async () => {
          const id = editOrder?.id;
          setEditOrder(null);
          const fresh = await refreshOrders();
          const next = fresh.find((o) => o.id === id) ?? null;
          setSelected(next);
          if (next) {
            setLabelGenResult(null);
            setDueEdit(null);
            setDueError(null);
            setOrderEvents([]);
            eventsFetchId.current = Number(next.id);
            fetchOrder(Number(next.id)).then((r) => {
              if (eventsFetchId.current !== Number(next.id)) return;
              setOrderEvents(r.events);
            }).catch(() => {});
          }
        }}
      />
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl border border-sand-200 bg-white py-2 pl-3 pr-8 text-sm capitalize text-cocoa-muted outline-none focus:border-palm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "all" ? `All ${label}` : o}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-cocoa-muted" />
    </div>
  );
}
