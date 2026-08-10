import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, List, CalendarDays, CalendarRange, CalendarClock, Plus, Clock } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { useReminders } from "../hooks/useReminders";
import { calendarGrid, type CalendarCell } from "../utils/calendarGrid";
import { dueTier, DUE_TIER_LABELS, formatCurrency, formatDate, urgencyRank } from "../utils/format";
import { cn } from "../utils/cn";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import OrderModal from "../components/OrderModal";
import ProductIcon from "../components/ProductIcon";
import { loadReminderConfig } from "../utils/reminders";
import type { Order } from "../types";
import type { Page } from "../App";

export type CalendarViewMode = "month" | "week" | "day" | "list";

export function ordersByIso(orders: Order[]): Map<string, Order[]> {
  const map = new Map<string, Order[]>();
  for (const o of orders) {
    if (o.status === "completed" || o.status === "cancelled") continue;
    const iso = o.dueDate.slice(0, 10);
    const arr = map.get(iso) ?? [];
    arr.push(o);
    map.set(iso, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => urgencyRank(a) - urgencyRank(b));
  return map;
}

export default function CalendarView({
  setPage,
  onOpenInventory,
}: {
  setPage: (p: Page) => void;
  onOpenInventory: (highlightId: string) => void;
}) {
  const { orders } = useStore();
  const { unreadCount } = useReminders();
  const [mode, setMode] = useState<CalendarViewMode>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [newOrderOpen, setNewOrderOpen] = useState(false);

  const selectedIso = useMemo(() => {
    const d = cursor;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [cursor]);

  const byIso = useMemo(() => ordersByIso(orders), [orders]);

  // Deep links: #calendar/2026-06-11 → that date's Day view
  useEffect(() => {
    const m = window.location.hash.match(/^#calendar\/(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      setMode("day");
      setCursor(new Date(m[1] + "T12:00:00"));
    }
  }, []);

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c);
      if (mode === "month") d.setMonth(d.getMonth() + delta);
      else if (mode === "week") d.setDate(d.getDate() + delta * 7);
      else d.setDate(d.getDate() + delta);
      return d;
    });
  }

  function tierFor(o: Order) {
    return dueTier(o.dueDate, o.status);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-sand-200 bg-white p-1 shadow-sm">
          {(["month", "week", "day", "list"] as CalendarViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition",
                mode === m ? "bg-palm text-white" : "text-cocoa-muted hover:bg-sand-100",
              )}
            >
              {m === "month" ? <CalendarDays size={14} /> : m === "week" ? <CalendarRange size={14} /> : m === "day" ? <CalendarClock size={14} /> : <List size={14} />}
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-sand-200 bg-white px-2 py-1 shadow-sm">
            <button onClick={() => shift(-1)} className="rounded-lg p-1.5 text-cocoa-muted hover:bg-sand-100" aria-label="Previous">
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-32 text-center text-sm font-semibold text-cocoa">{monthLabel}</span>
            <button onClick={() => shift(1)} className="rounded-lg p-1.5 text-cocoa-muted hover:bg-sand-100" aria-label="Next">
              <ChevronRight size={16} />
            </button>
          </div>
          {unreadCount > 0 && (
            <Badge tone="today">{unreadCount} reminder{unreadCount === 1 ? "" : "s"}</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {mode === "month" && <MonthGrid byIso={byIso} cursor={cursor} todayIso={todayIso} onSelect={(iso) => { setCursor(new Date(iso + "T12:00:00")); setMode("day"); }} />}
          {mode === "week" && <WeekGrid byIso={byIso} cursor={cursor} todayIso={todayIso} onSelect={(iso) => { setCursor(new Date(iso + "T12:00:00")); setMode("day"); }} />}
          {mode === "list" && <ListView byIso={byIso} />}
          {mode === "day" && (
            <DayView
              cursor={cursor}
              byIso={byIso}
              onGoMonth={() => setMode("month")}
              onNewOrder={() => setNewOrderOpen(true)}
            />
          )}
        </div>

        <div className="w-full lg:w-80">
          <div className="rounded-xl border border-sand-200 bg-white p-4 text-center text-sm text-cocoa-muted">
            Side panel (reminders + prep list) ships in Task 9.
          </div>
        </div>
      </div>

      {newOrderOpen && (
        <OrderModal key={selectedIso} open onClose={() => setNewOrderOpen(false)} defaultDueDate={selectedIso} />
      )}
    </div>
  );
}

function MonthGrid({ byIso, cursor, todayIso, onSelect }: {
  byIso: Map<string, Order[]>;
  cursor: Date;
  todayIso: string;
  onSelect: (iso: string) => void;
}) {
  const cells = calendarGrid(cursor.getFullYear(), cursor.getMonth(), todayIso);
  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-sand-100 bg-sand-50 text-center text-[11px] font-semibold uppercase tracking-wide text-cocoa-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => (
          <MonthCell key={cell.iso} cell={cell} orders={byIso.get(cell.iso) ?? []} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function MonthCell({ cell, orders, onSelect }: { cell: CalendarCell; orders: Order[]; onSelect: (iso: string) => void }) {
  const maxTier = orders.reduce<ReturnType<typeof dueTier> | null>((acc, o) => {
    const t = dueTier(o.dueDate, o.status);
    if (t === "overdue") return "overdue";
    if (t === "today" && acc !== "overdue") return "today";
    if (t === "tomorrow" && acc !== "overdue" && acc !== "today") return "tomorrow";
    return acc;
  }, null);
  return (
    <button
      onClick={() => onSelect(cell.iso)}
      className={cn(
        "flex min-h-16 flex-col gap-1 border-r border-b border-sand-100 p-1.5 text-left transition hover:bg-sand-50",
        !cell.inMonth && "bg-sand-50/60 opacity-50",
      )}
    >
      <span className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full text-xs",
        cell.isToday ? "bg-coral font-bold text-white" : "text-cocoa",
      )}>
        {cell.date.getDate()}
      </span>
      <div className="space-y-0.5">
        {orders.slice(0, 3).map((o) => (
          <div key={o.id} className="flex items-center gap-1 text-[10px] text-cocoa-muted">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
              dueTier(o.dueDate, o.status) === "overdue" ? "bg-hibiscus" :
              dueTier(o.dueDate, o.status) === "today" ? "bg-coral" :
              dueTier(o.dueDate, o.status) === "tomorrow" ? "bg-amber-500" : "bg-mid-green")} />
            <span className="truncate">{o.orderNumber}</span>
          </div>
        ))}
        {orders.length > 3 && <p className="text-[10px] font-medium text-coral">+{orders.length - 3} more</p>}
      </div>
    </button>
  );
}

function WeekGrid({ byIso, cursor, todayIso, onSelect }: {
  byIso: Map<string, Order[]>;
  cursor: Date;
  todayIso: string;
  onSelect: (iso: string) => void;
}) {
  const start = new Date(cursor);
  start.setDate(start.getDate() - start.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 gap-px bg-sand-100">
        {days.map((d) => {
          const dIso = iso(d);
          const orders = byIso.get(dIso) ?? [];
          const isToday = dIso === todayIso;
          return (
            <button key={dIso} onClick={() => onSelect(dIso)} className="flex min-h-40 flex-col gap-1 bg-white p-2 text-left transition hover:bg-sand-50">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase text-cocoa-muted">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", isToday ? "bg-coral text-white" : "text-cocoa")}>
                  {d.getDate()}
                </span>
              </div>
              <div className="mt-1 space-y-1">
                {orders.slice(0, 3).map((o) => (
                  <div key={o.id} className="rounded-md bg-sand-50 px-1.5 py-1 text-[10px] font-medium text-cocoa ring-1 ring-inset ring-sand-200">
                    {o.orderNumber} · {formatCurrency(o.total)}
                  </div>
                ))}
                {orders.length > 3 && <p className="text-[10px] font-medium text-coral">+{orders.length - 3} more</p>}
                {orders.length === 0 && <p className="text-[10px] text-cocoa-muted">—</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ byIso }: { byIso: Map<string, Order[]> }) {
  const all = [...byIso.entries()]
    .filter(([iso]) => iso >= new Date().toISOString().slice(0, 10))
    .flatMap(([, orders]) => orders)
    .sort((a, b) => urgencyRank(a) - urgencyRank(b));
  if (all.length === 0) {
    return <div className="rounded-xl border border-sand-200 bg-white p-10 text-center text-sm text-cocoa-muted">No upcoming orders.</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="divide-y divide-sand-100">
        {all.map((o) => {
          const tier = dueTier(o.dueDate, o.status);
          return (
            <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cocoa">{o.orderNumber} · {o.customerName}</p>
                <p className="text-xs text-cocoa-muted">{formatDate(o.dueDate)} · {o.items.length} item(s)</p>
              </div>
              <div className="flex items-center gap-2">
                {tier !== "inactive" && <Badge tone={tier}>{DUE_TIER_LABELS[tier]}</Badge>}
                <span className="text-sm font-semibold text-cocoa">{formatCurrency(o.total)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ cursor, byIso, onGoMonth, onNewOrder }: {
  cursor: Date;
  byIso: Map<string, Order[]>;
  onGoMonth: () => void;
  onNewOrder: () => void;
}) {
  const { profile } = useStore();
  const cfg = loadReminderConfig(profile?.reminders);
  const iso = useMemo(() => {
    const d = cursor;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [cursor]);

  const orders = byIso.get(iso) ?? [];
  const scheduled = orders.filter((o) => !Number.isNaN(new Date(o.dueDate).getHours()));
  const unscheduled = orders.filter((o) => Number.isNaN(new Date(o.dueDate).getHours()));

  const hours: number[] = [];
  for (let h = cfg.dayStartTime; h <= cfg.dayEndTime; h++) hours.push(h);

  const hourOf = (o: Order) => new Date(o.dueDate).getHours();

  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={onGoMonth} className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand-200 text-cocoa-muted hover:bg-sand-100" aria-label="Back to month">
            <CalendarDays size={14} />
          </button>
          <div>
            <p className="font-serif text-lg font-semibold text-cocoa">
              {cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
            <p className="text-xs text-cocoa-muted">{orders.length} order{orders.length === 1 ? "" : "s"} · pickup times {cfg.dayStartTime}:00–{cfg.dayEndTime}:00</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => document.getElementById("prep-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="rounded-xl border border-palm/30 bg-white px-3 py-2 text-xs font-medium text-palm hover:bg-palm/5"
          >
            Prep needs for this day →
          </button>
          <button
            onClick={onNewOrder}
            className="rounded-xl bg-palm px-3 py-2 text-xs font-semibold text-white hover:shadow-md"
          >
            + New order for this day
          </button>
        </div>
      </div>

      <div className="relative">
        {hours.map((h) => {
          const cellOrders = scheduled.filter((o) => hourOf(o) === h);
          return (
            <div key={h} className="flex border-b border-sand-100 last:border-b-0">
              <div className="w-16 shrink-0 border-r border-sand-100 px-3 py-3 text-right font-mono text-xs text-cocoa-muted">
                {h > 12 ? h - 12 : h}:00{h >= 12 ? "pm" : "am"}
              </div>
              <div className="min-h-16 flex-1 space-y-1.5 px-3 py-2">
                {cellOrders.map((o) => <OrderTimelineCard key={o.id} order={o} />)}
                {cellOrders.length === 0 && <p className="px-2 py-1 text-xs italic text-cocoa-muted/60">open</p>}
              </div>
            </div>
          );
        })}

        {unscheduled.length > 0 && (
          <div className="border-t-2 border-dashed border-sand-200 bg-sand-50/50 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-cocoa-muted">Unscheduled (no pickup time set)</p>
            <div className="space-y-1.5">
              {unscheduled.map((o) => <OrderTimelineCard key={o.id} order={o} />)}
            </div>
          </div>
        )}

        {orders.length === 0 && (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-cocoa-muted">No orders scheduled for this day.</p>
            <button onClick={onNewOrder} className="mt-3 rounded-xl bg-palm px-4 py-2 text-sm font-semibold text-white hover:shadow-md">
              + New order for this day
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderTimelineCard({ order }: { order: Order }) {
  const tier = dueTier(order.dueDate, order.status);
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setDetailOpen(true)}
        className="flex w-full flex-col gap-1 rounded-lg bg-sand-50 px-3 py-2 text-left ring-1 ring-inset ring-sand-200 transition hover:bg-sand-100"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-cocoa">{order.orderNumber} · {order.customerName}</span>
          <span className="text-sm font-semibold text-cocoa">{formatCurrency(order.total)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-cocoa-muted">
          {order.items.slice(0, 3).map((i) => (
            <span key={i.productId + i.name} className="flex items-center gap-1">
              <ProductIcon emoji={i.emoji} imageUrl={undefined} size={14} /> {i.qty}× {i.name}
            </span>
          ))}
          {order.items.length > 3 && <span>+{order.items.length - 3} more</span>}
          {tier !== "inactive" && <Badge tone={tier}>{DUE_TIER_LABELS[tier]}</Badge>}
        </div>
        {order.notes && <p className="mt-0.5 line-clamp-1 text-xs italic text-cocoa-muted">“{order.notes}”</p>}
      </button>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={`${order.orderNumber} · ${order.customerName}`}>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-cocoa-muted">
            Pickup: {formatDate(order.dueDate)} · Payment: {order.paymentStatus}
          </p>
          <div className="divide-y divide-sand-100 rounded-xl border border-sand-100">
            {order.items.map((i) => (
              <div key={i.productId + i.name} className="flex items-center justify-between px-3 py-2">
                <span className="flex items-center gap-2 text-cocoa">
                  <ProductIcon emoji={i.emoji} imageUrl={undefined} size={16} /> {i.qty}× {i.name}
                </span>
                <span className="text-xs text-cocoa-muted">{formatCurrency(i.price)}</span>
              </div>
            ))}
          </div>
          {order.notes && <p className="rounded-lg bg-sand-50 px-3 py-2 text-xs italic text-cocoa-muted">“{order.notes}”</p>}
          <button onClick={() => setDetailOpen(false)} className="w-full rounded-xl border border-sand-200 py-2 text-sm font-medium text-cocoa hover:bg-sand-50">
            Close
          </button>
        </div>
      </Modal>
    </>
  );
}
