import { useMemo } from "react";
import {
  DollarSign,
  ClipboardList,
  PackageX,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useStore } from "../context/StoreContext";
import StatCard from "../components/ui/StatCard";
import Badge from "../components/ui/Badge";
import { formatCurrency, formatDate, PAYMENT_METHOD_COLORS, PAYMENT_METHOD_LABELS } from "../utils/format";
import type { Page } from "../App";

export default function Dashboard({ setPage }: { setPage: (p: Page) => void }) {
  const { orders, inventory, payments, products, loading } = useStore();

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-palm border-t-transparent" />
      </div>
    );
  }

  const stats = useMemo(() => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthPayments = payments.filter((p) => new Date(p.date) >= startOfMonth);
    const revenueMonth = monthPayments.reduce((s, p) => s + p.amount, 0);
    const pendingOrders = orders.filter((o) => o.status === "pending" || o.status === "in-progress");
    const lowStock = inventory.filter((i) => i.quantity <= i.reorderLevel);
    const avgOrder = orders.length ? orders.reduce((s, o) => s + o.total, 0) / orders.length : 0;
    return { revenueMonth, pendingOrders, lowStock, avgOrder };
  }, [orders, inventory, payments]);

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
    orders.forEach((o) => {
      const d = new Date(o.createdAt);
      d.setHours(0, 0, 0, 0);
      const bucket = days.find((day) => day.date.getTime() === d.getTime());
      if (bucket) bucket.revenue += o.total;
    });
    return days;
  }, [orders]);

  const bestSellers = useMemo(() => {
    const counts: Record<string, number> = {};
    orders.forEach((o) => o.items.forEach((i) => (counts[i.productId] = (counts[i.productId] || 0) + i.qty)));
    return Object.entries(counts)
      .map(([id, qty]) => ({ product: products.find((p) => p.id === id), qty }))
      .filter((x) => x.product)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 4);
  }, [orders, products]);

  const recentOrders = [...orders]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="overflow-hidden rounded-[40px_12px_40px_12px] bg-gradient-to-r from-coral via-hibiscus to-mid-green p-6 text-white shadow-lg">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-medium text-white/80">Bienvenidos de vuelta</p>
            <h2 className="mt-1 font-serif text-2xl font-semibold">Here's how your bakery is doing</h2>
            <p className="mt-1 text-sm text-white/80">
              {stats.pendingOrders.length} orders need attention · {stats.lowStock.length} items low on stock
            </p>
          </div>
          <button
            onClick={() => setPage("orders")}
            className="flex items-center gap-1.5 self-start rounded-xl bg-white/20 px-4 py-2 text-sm font-medium backdrop-blur transition hover:bg-white/30"
          >
            View Orders <ArrowUpRight size={16} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue this month" value={formatCurrency(stats.revenueMonth)} icon={DollarSign} tone="mid-green" />
        <StatCard label="Orders in progress" value={String(stats.pendingOrders.length)} icon={ClipboardList} tone="palm" />
        <StatCard label="Low stock items" value={String(stats.lowStock.length)} icon={PackageX} tone="hibiscus" />
        <StatCard label="Avg order value" value={formatCurrency(stats.avgOrder)} icon={TrendingUp} tone="coral" />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 font-serif text-sm font-semibold text-cocoa">Revenue — last 7 days</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={last7days}>
              <CartesianGrid vertical={false} stroke="#f5edd8" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#706561" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#706561" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                formatter={(v) => formatCurrency(Number(v))}
                contentStyle={{ borderRadius: 12, border: "1px solid #e8dbc4", fontSize: 13 }}
              />
              <Bar dataKey="revenue" fill="#f7a8a4" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
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
        <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-sand-100 px-5 py-4">
            <h3 className="font-serif text-sm font-semibold text-cocoa">Recent orders</h3>
            <button onClick={() => setPage("orders")} className="text-xs font-medium text-coral hover:underline">
              View all
            </button>
          </div>
          <div className="divide-y divide-sand-100">
            {recentOrders.map((o) => (
              <div key={o.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-cocoa">
                    {o.orderNumber} · {o.customerName}
                  </p>
                  <p className="text-xs text-cocoa-muted">{formatDate(o.createdAt)} · {o.items.length} item(s)</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-cocoa">{formatCurrency(o.total)}</span>
                  <Badge tone={o.status}>{o.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white shadow-sm">
          <div className="border-b border-sand-100 px-5 py-4">
            <h3 className="font-serif text-sm font-semibold text-cocoa">Best sellers</h3>
          </div>
          <div className="divide-y divide-sand-100">
            {bestSellers.map(({ product, qty }) => (
              <div key={product!.id} className="flex items-center justify-between px-5 py-3">
                <span className="flex items-center gap-2 text-sm text-cocoa">
                  <span className="text-lg">{product!.emoji}</span> {product!.name}
                </span>
                <span className="text-xs font-semibold text-cocoa-muted">{qty} sold</span>
              </div>
            ))}
            {bestSellers.length === 0 && (
              <p className="px-5 py-6 text-center text-sm text-cocoa-muted">No sales yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Low stock alerts */}
      {stats.lowStock.length > 0 && (
        <div className="rounded-[40px_12px_40px_12px] border border-hibiscus-light/30 bg-hibiscus-light/10 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-hibiscus">
            <PackageX size={16} /> Low stock alerts
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.lowStock.map((i) => (
              <span key={i.id} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-hibiscus shadow-sm">
                {i.name} — {i.quantity} {i.unit} left
              </span>
            ))}
          </div>
          <button onClick={() => setPage("inventory")} className="mt-3 text-xs font-medium text-hibiscus hover:underline">
            Manage inventory →
          </button>
        </div>
      )}
    </div>
  );
}
