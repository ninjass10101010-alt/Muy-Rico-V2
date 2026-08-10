import { useMemo } from "react";
import {
  DollarSign,
  ClipboardList,
  PackageX,
  TrendingUp,
  ArrowUpRight,
  MessageSquareQuote,
  Wallet,
  CalendarClock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "../context/StoreContext";
import StatCard from "../components/ui/StatCard";
import Badge from "../components/ui/Badge";
import ProductIcon from "../components/ProductIcon";
import { formatCurrency, formatDate, PAYMENT_METHOD_COLORS, PAYMENT_METHOD_LABELS, dueTier, urgencyRank, DUE_TIER_LABELS } from "../utils/format";
import type { Page } from "../App";
import muyRicoLogo from "../assets/muy_rico_logo_transparent.webp";

export default function Dashboard({ setPage }: { setPage: (p: Page) => void }) {
  const { orders, inventory, payments, products, loading, quotes } = useStore();

  const stats = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthPayments = payments.filter((p) => new Date(p.date) >= startOfMonth);
    const prevMonthPayments = payments.filter((p) => {
      const d = new Date(p.date);
      return d >= startOfPrevMonth && d < startOfMonth;
    });
    const revenueMonth = monthPayments.reduce((s, p) => s + p.amount, 0);
    const revenuePrevMonth = prevMonthPayments.reduce((s, p) => s + p.amount, 0);
    const bookedMonth = orders
      .filter((o) => new Date(o.createdAt) >= startOfMonth)
      .reduce((s, o) => s + o.total, 0);
    const pendingOrders = orders.filter((o) => o.status === "pending" || o.status === "in-progress");
    const lowStock = inventory.filter((i) => i.quantity <= i.reorderLevel);
    const lowStockCritical = lowStock.filter((i) => i.quantity <= 0).length;
    const avgOrder = orders.length ? orders.reduce((s, o) => s + o.total, 0) / orders.length : 0;
    const pendingQuotes = quotes.filter((q) => q.status === "new").length;
    const active = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled");
    const awaitingPayment = active.filter((o) => o.paymentStatus === "unpaid" || o.paymentStatus === "partial");
    const owedTotal = awaitingPayment.reduce((sum, o) => {
      const paid = payments.filter((p) => p.orderId === o.id).reduce((s, p) => s + p.amount, 0);
      return sum + Math.max(0, o.total - paid);
    }, 0);
    const dueToday = active.filter((o) => dueTier(o.dueDate, o.status) === "today").length;
    const due48h = active.filter((o) => {
      const t = dueTier(o.dueDate, o.status);
      return t === "overdue" || t === "today" || t === "tomorrow";
    }).length;
    const pctDelta = revenuePrevMonth > 0 ? ((revenueMonth - revenuePrevMonth) / revenuePrevMonth) * 100 : 0;
    return {
      revenueMonth,
      revenuePrevMonth,
      pctDelta,
      bookedMonth,
      pendingOrders,
      lowStock,
      lowStockCritical,
      avgOrder,
      pendingQuotes,
      awaitingPayment: awaitingPayment.length,
      owedTotal,
      dueToday,
      due48h,
    };
  }, [orders, inventory, payments, quotes]);

  const paymentBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    payments.forEach((p) => {
      map[p.method] = (map[p.method] || 0) + p.amount;
    });
    return Object.entries(map).map(([method, value]) => ({
      name: PAYMENT_METHOD_LABELS[method] || method,
      value,
      method,
    }));
  }, [payments]);

  const last7days = useMemo(() => {
    const days: { label: string; date: Date; revenue: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      days.push({ label: d.toLocaleDateString("en-US", { weekday: "short" }), date: d, revenue: 0 });
    }
    payments.forEach((p) => {
      const d = new Date(p.date);
      d.setHours(0, 0, 0, 0);
      const bucket = days.find((day) => day.date.getTime() === d.getTime());
      if (bucket) bucket.revenue += p.amount;
    });
    return days;
  }, [payments]);

  const revenueSpark = useMemo(() => last7days.map((d) => d.revenue), [last7days]);

  const revenueAvg7 = useMemo(
    () => revenueSpark.reduce((s, v) => s + v, 0) / Math.max(1, revenueSpark.length || 1),
    [revenueSpark],
  );

  const bestSellers = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach((o) => o.items.forEach((i) => (counts[i.productId] = (counts[i.productId] || 0) + i.qty)));
    return Object.entries(counts)
      .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
      .filter((x) => x.product)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 4);
  }, [orders, products]);

  const attentionOrders = useMemo(() => {
    return [...orders]
      .filter((o) => o.status !== "completed" && o.status !== "cancelled")
      .sort((a, b) => urgencyRank(a) - urgencyRank(b))
      .slice(0, 6);
  }, [orders]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-palm border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome banner — solid bakery warmth */}
      <div
        className="relative overflow-hidden rounded-xl bg-palm p-6 shadow-lg"
        style={{
          background: "linear-gradient(135deg, #1e4636 0%, #16352a 100%)",
        }}
      >
        {/* Flour-dust texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle, #faf5ef 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="flex shrink-0 items-center justify-center bg-sand-50/95 px-3 py-2 shadow-md" style={{ borderRadius: 8 }}>
              <img src={muyRicoLogo} alt="Muy Rico" className="h-11 w-auto max-w-[140px] object-contain" />
            </div>
            <div>
              <p className="text-sm font-medium text-sand-50/80">Bienvenidos de vuelta</p>
              <h2 className="mt-0.5 font-serif text-2xl font-semibold text-sand-50">Here's how your bakery is doing</h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-sand-50/80">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-coral" />
                  {stats.pendingOrders.length} orders need attention · {stats.lowStock.length} items low on stock
                </span>
                <span className="rounded-full bg-sand-50/15 px-2.5 py-0.5 text-xs text-sand-50/90 ring-1 ring-inset ring-sand-50/20">
                  Booked this month: {formatCurrency(stats.bookedMonth)}
                </span>
              </p>
            </div>
          </div>
          <button
            onClick={() => setPage("orders")}
            className="flex items-center gap-1.5 self-start rounded-xl bg-sand-50 px-4 py-2 text-sm font-semibold text-palm shadow-sm transition hover:bg-sand-100"
          >
            View Orders <ArrowUpRight size={16} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <StatCard
          label="Revenue this month"
          value={formatCurrency(stats.revenueMonth)}
          icon={DollarSign}
          tone="mid-green"
          trend={{ pctDelta: stats.pctDelta, spark: revenueSpark }}
          onClick={() => setPage("orders")}
        />
        <StatCard
          label="Awaiting payment"
          value={formatCurrency(stats.owedTotal)}
          sub={`${stats.awaitingPayment} order${stats.awaitingPayment === 1 ? "" : "s"}`}
          icon={Wallet}
          tone="coral"
          onClick={() => setPage("orders")}
        />
        <StatCard
          label="Due next 48h"
          value={String(stats.due48h)}
          sub={`${stats.dueToday} today`}
          icon={CalendarClock}
          tone="palm"
          onClick={() => setPage("orders")}
        />
        <StatCard
          label="Orders in progress"
          value={String(stats.pendingOrders.length)}
          icon={ClipboardList}
          tone="palm"
          onClick={() => setPage("orders")}
        />
        <StatCard
          label="Avg order value"
          value={formatCurrency(stats.avgOrder)}
          icon={TrendingUp}
          tone="coral"
          onClick={() => setPage("orders")}
        />
        <StatCard
          label="Low stock items"
          value={String(stats.lowStock.length)}
          sub={`${stats.lowStockCritical} critical`}
          icon={PackageX}
          tone="hibiscus"
          onClick={() => setPage("inventory")}
        />
        <StatCard
          label="Cake Quotes pending"
          value={String(stats.pendingQuotes)}
          icon={MessageSquareQuote}
          tone="coral"
          onClick={() => setPage("quotes")}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 font-serif text-sm font-semibold text-cocoa">Revenue collected — last 7 days</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={last7days}>
              <defs>
                <linearGradient id="revenueBarGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f7a8a4" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="#fad9d4" stopOpacity={0.6} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="#f5edd8" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#706561" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#706561" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                formatter={(v) => formatCurrency(Number(v))}
                contentStyle={{ borderRadius: 12, border: "1px solid #e8dbc4", fontSize: 13 }}
              />
              <ReferenceLine
                y={revenueAvg7}
                stroke="#c8a978"
                strokeDasharray="4 4"
                strokeLinecap="round"
                label={{ value: "avg", position: "right", fill: "#a8967a", fontSize: 10 }}
              />
              <Bar dataKey="revenue" fill="url(#revenueBarGradient)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-serif text-sm font-semibold text-cocoa">Payment methods</h3>
          {paymentBreakdown.length === 0 ? (
            <p className="py-10 text-center text-sm text-cocoa-muted">No payments recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={paymentBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={3}>
                  {paymentBreakdown.map((entry) => (
                    <Cell key={entry.method} fill={PAYMENT_METHOD_COLORS[entry.method]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 space-y-1.5">
            {paymentBreakdown.map((p) => (
              <div key={p.method} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-cocoa-muted">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: PAYMENT_METHOD_COLORS[p.method] }}
                  />
                  {p.name}
                </span>
                <span className="font-medium text-cocoa">{formatCurrency(p.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent orders + Best sellers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-sand-200 bg-white shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-sand-100 px-5 py-4">
            <h3 className="font-serif text-sm font-semibold text-cocoa">Orders needing attention</h3>
            <button onClick={() => setPage("orders")} className="text-xs font-medium text-coral hover:underline">
              View all
            </button>
          </div>
          {attentionOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
              <p className="text-sm text-cocoa-muted">All caught up — no orders need attention.</p>
              <button onClick={() => setPage("orders")} className="text-xs font-medium text-coral hover:underline">
                View all orders →
              </button>
            </div>
          ) : (
            <div className="divide-y divide-sand-100">
              {attentionOrders.map((o) => {
                const tier = dueTier(o.dueDate, o.status);
                return (
                  <div
                    key={o.id}
                    onClick={() => setPage("orders")}
                    className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 transition hover:bg-sand-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-cocoa">
                        {o.orderNumber} · {o.customerName}
                      </p>
                      <p className="text-xs text-cocoa-muted">{formatDate(o.createdAt)} · {o.items.length} item(s)</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {tier === "overdue" || tier === "today" || tier === "tomorrow" || tier === "this-week" ? (
                        <Badge tone={tier}>
                          {tier === "this-week" ? formatDate(o.dueDate) : DUE_TIER_LABELS[tier]}
                        </Badge>
                      ) : null}
                      {o.paymentStatus === "paid" ? (
                        <CheckCircle2 size={14} className="text-mid-green" />
                      ) : o.paymentStatus === "partial" ? (
                        <Wallet size={14} className="text-coral" />
                      ) : (
                        <AlertCircle size={14} className="text-hibiscus" />
                      )}
                      <span className="text-sm font-semibold text-cocoa">{formatCurrency(o.total)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-sand-200 bg-white shadow-sm">
          <div className="border-b border-sand-100 px-5 py-4">
            <h3 className="font-serif text-sm font-semibold text-cocoa">Best sellers</h3>
          </div>
          <div className="divide-y divide-sand-100">
            {bestSellers.map(({ product, qty }) => (
              <div key={product!.id} className="flex items-center justify-between px-5 py-3">
                <span className="flex items-center gap-2 text-sm text-cocoa">
                  <ProductIcon emoji={product!.emoji} imageUrl={product!.image_url} size={28} /> {product!.name}
                </span>
                <span className="text-xs font-semibold text-cocoa-muted">{qty} sold</span>
              </div>
            ))}
            {bestSellers.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 px-5 py-8 text-center">
                <p className="text-sm text-cocoa-muted">No sales yet.</p>
                <button onClick={() => setPage("products")} className="text-xs font-medium text-coral hover:underline">
                  Set up your menu →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Low stock alerts */}
      {stats.lowStock.length > 0 && (
        <div className="rounded-xl border border-hibiscus-light/30 bg-hibiscus-light/10 p-5">
          {(() => {
            const critical = stats.lowStock.filter((i) => i.quantity <= 0);
            const low = stats.lowStock.filter((i) => i.quantity > 0);
            return (
              <>
                {critical.length > 0 && (
                  <div className="mb-3">
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-hibiscus">
                      <AlertTriangle size={16} /> Critical ({critical.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {critical.map((i) => (
                        <span key={i.id} className="flex items-center gap-1.5 rounded-full bg-hibiscus/15 px-3 py-1.5 text-xs font-medium text-hibiscus ring-1 ring-inset ring-hibiscus/30">
                          {i.name} — {i.quantity} {i.unit} left
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {low.length > 0 && (
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-coral">
                      <PackageX size={16} /> Low ({low.length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {low.map((i) => (
                        <span key={i.id} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-coral shadow-sm ring-1 ring-inset ring-coral/20">
                          {i.name} — {i.quantity} {i.unit} left
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
          <button onClick={() => setPage("inventory")} className="mt-3 text-xs font-medium text-hibiscus hover:underline">
            Manage inventory →
          </button>
        </div>
      )}
    </div>
  );
}
