import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, List, CalendarDays, CalendarRange, CalendarClock } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { useReminders } from "../hooks/useReminders";
import { calendarGrid, type CalendarCell } from "../utils/calendarGrid";
import { dueTier, DUE_TIER_LABELS, formatCurrency, formatDate, urgencyRank } from "../utils/format";
import { cn } from "../utils/cn";
import Badge from "../components/ui/Badge";
import ProductIcon from "../components/ProductIcon";
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
            <div className="rounded-xl border border-sand-200 bg-white p-6 text-center text-sm text-cocoa-muted">
              Day view ships in the next task.
            </div>
          )}
        </div>

        <div className="w-full lg:w-80">
          <div className="rounded-xl border border-sand-200 bg-white p-4 text-center text-sm text-cocoa-muted">
            Side panel (reminders + prep list) ships in Task 9.
          </div>
        </div>
      </div>
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
