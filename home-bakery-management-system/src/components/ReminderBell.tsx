import { useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, CheckCheck, Clock } from "lucide-react";
import { useReminders } from "../hooks/useReminders";
import { dueTier, DUE_TIER_LABELS, formatCurrency, formatDate } from "../utils/format";
import { cn } from "../utils/cn";

export default function ReminderBell({
  onOpenCalendar,
  onOpenDate,
}: {
  onOpenCalendar: () => void;
  onOpenDate: (isoDate: string) => void;
}) {
  const { reminders, unreadCount, snooze, dismiss, markAllRead } = useReminders();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const tierLabel = (o: (typeof reminders)[number]) =>
    o.tier === "leadDays" ? `Due ${formatDate(o.dueDate)}` : DUE_TIER_LABELS[dueTier(o.order.dueDate, o.order.status)];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-xl border border-sand-200 bg-white p-2.5 text-cocoa-muted transition hover:bg-sand-100 hover:text-cocoa"
        aria-label="Reminders"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-sand-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-sand-100 px-4 py-3">
            <p className="text-sm font-semibold text-cocoa">Reminders</p>
            {reminders.length > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs font-medium text-coral hover:underline">
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>

          {reminders.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-cocoa-muted">
              All caught up — no upcoming order reminders.
            </div>
          ) : (
            <div className="max-h-80 divide-y divide-sand-100 overflow-y-auto">
              {reminders.map((r) => (
                <div key={r.order.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-[10px] font-bold uppercase tracking-wide",
                      r.tier === "overdue" ? "text-hibiscus" : r.tier === "today" ? "text-coral" : r.tier === "tomorrow" ? "text-amber-600" : "text-cocoa-muted")}>
                      {r.tier}
                    </span>
                    <span className="text-xs font-semibold text-cocoa">{formatCurrency(r.order.total)}</span>
                  </div>
                  <p className="mt-0.5 text-sm font-medium text-cocoa">
                    {r.order.orderNumber} · {r.order.customerName}
                  </p>
                  <p className="text-xs text-cocoa-muted">{tierLabel(r)} · {r.order.items.length} item(s)</p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => { onOpenDate(r.order.dueDate.slice(0, 10)); setOpen(false); }}
                      className="flex items-center gap-1 rounded-lg border border-sand-200 px-2 py-1 text-xs font-medium text-palm hover:bg-sand-50"
                    >
                      <CalendarDays size={12} /> View
                    </button>
                    <button
                      onClick={() => snooze(r.order.id, 24)}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-cocoa-muted hover:bg-sand-100"
                    >
                      <Clock size={12} /> Snooze 24h
                    </button>
                    <button
                      onClick={() => dismiss(r.order.id)}
                      className="ml-auto text-xs font-medium text-cocoa-muted hover:text-hibiscus"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => { onOpenCalendar(); setOpen(false); }}
            className="w-full border-t border-sand-100 bg-sand-50 px-4 py-2.5 text-center text-xs font-semibold text-palm hover:bg-sand-100"
          >
            Open Calendar →
          </button>
        </div>
      )}
    </div>
  );
}
