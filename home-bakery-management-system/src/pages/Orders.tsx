import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, Trash2, Wallet } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { formatCurrency, formatDate, PAYMENT_METHOD_LABELS } from "../utils/format";
import type { Order, OrderStatus, PaymentMethod } from "../types";

const STATUS_FLOW: OrderStatus[] = ["pending", "in-progress", "ready", "completed", "cancelled"];

export default function Orders({ search }: { search: string }) {
  const { orders, deductInventoryForOrder, recordPayment, profile, apiUpdateOrder, apiCancelOrder } = useStore();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Order | null>(null);
  const [payFor, setPayFor] = useState<Order | null>(null);
  const [payMethod, setPayMethod] = useState<PaymentMethod>("cash");

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
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, statusFilter, sourceFilter, search]);

  async function updateStatus(order: Order, status: OrderStatus) {
    try {
      await apiUpdateOrder(Number(order.id), { status });
      if (status === "completed" && !order.inventoryDeducted) {
        deductInventoryForOrder(order);
      }
    } catch (err) {
      console.error("Failed to update order:", err);
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiCancelOrder(Number(id));
      setSelected(null);
    } catch (err) {
      console.error("Failed to cancel order:", err);
    }
  }

  async function confirmPayment() {
    if (!payFor) return;
    const updated: Order = { ...payFor, paymentStatus: "paid", paymentMethod: payMethod };
    apiUpdateOrder(Number(payFor.id), { payment_status: "paid" });
    await recordPayment(updated);
    setPayFor(null);
  }

  const enabledMethods = (Object.keys(profile.acceptedMethods) as PaymentMethod[]).filter(
    (m) => profile.acceptedMethods[m],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={["all", ...STATUS_FLOW]}
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

      <div className="overflow-hidden rounded-[40px_12px_40px_12px] border border-sand-200 bg-white shadow-sm">
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
              {filtered.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-sand-50" onClick={() => setSelected(o)}>
                  <td className="px-4 py-3 font-medium text-cocoa">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{o.customerName}</td>
                  <td className="px-4 py-3">
                    <Badge tone={o.source}>{o.source}</Badge>
                  </td>
                  <td className="px-4 py-3 text-cocoa-muted">{formatDate(o.dueDate)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={o.paymentStatus}>
                      {o.paymentStatus === "paid" && o.paymentMethod
                        ? PAYMENT_METHOD_LABELS[o.paymentMethod]
                        : o.paymentStatus}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={o.status}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateStatus(o, e.target.value as OrderStatus)}
                      className="rounded-lg border border-sand-200 bg-white px-2 py-1 text-xs capitalize outline-none focus:border-coral"
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
              ))}
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

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Order ${selected.orderNumber}` : ""}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-cocoa">{selected.customerName}</p>
                <p className="text-xs text-cocoa-muted">{selected.phone}</p>
              </div>
              <div className="flex gap-1.5">
                <Badge tone={selected.source}>{selected.source}</Badge>
                <Badge tone={selected.status}>{selected.status}</Badge>
              </div>
            </div>
            <div className="divide-y divide-sand-100 rounded-xl border border-sand-100">
              {selected.items.map((i) => (
                <div key={i.productId} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>
                    {i.emoji} {i.name} × {i.qty}
                  </span>
                  <span className="font-medium">{formatCurrency(i.qty * i.price)}</span>
                </div>
              ))}
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
            <div className="flex items-center justify-between text-xs text-cocoa-muted">
              <span>Ordered {formatDate(selected.createdAt)}</span>
              <span>Due {formatDate(selected.dueDate)}</span>
            </div>
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
              className="w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-coral"
            >
              {enabledMethods.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            <button
              onClick={confirmPayment}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-mid-green to-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
            >
              <CheckCircle2 size={16} /> Mark as Paid
            </button>
          </div>
        )}
      </Modal>
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
        className="appearance-none rounded-xl border border-sand-200 bg-white py-2 pl-3 pr-8 text-sm capitalize text-cocoa-muted outline-none focus:border-coral"
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
