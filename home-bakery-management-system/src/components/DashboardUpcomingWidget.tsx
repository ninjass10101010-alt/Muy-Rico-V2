import { Bell } from "lucide-react";
import { useReminders } from "../hooks/useReminders";
import Badge from "./ui/Badge";
import { formatCurrency, formatDate } from "../utils/format";

export default function DashboardUpcomingWidget({
  onOpenCalendar,
  onOpenDate,
}: {
  onOpenCalendar: () => void;
  onOpenDate: (iso: string) => void;
}) {
  const { reminders } = useReminders();
  const top = reminders.slice(0, 3);
  return (
    <div className="rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-sand-100 px-5 py-4">
        <h3 className="flex items-center gap-2 font-serif text-base font-semibold text-cocoa">
          <Bell size={15} className="text-coral" /> Upcoming reminders
        </h3>
        <button onClick={onOpenCalendar} className="text-xs font-medium text-coral hover:underline">
          View calendar
        </button>
      </div>
      {top.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-cocoa-muted">No upcoming order reminders.</p>
          <button onClick={onOpenCalendar} className="mt-2 text-xs font-medium text-coral hover:underline">
            View calendar →
          </button>
        </div>
      ) : (
        <div className="divide-y divide-sand-100">
          {top.map((r) => (
            <button
              key={r.order.id}
              onClick={() => onOpenDate(r.order.dueDate.slice(0, 10))}
              className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-sand-50 active:scale-[0.99]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cocoa">
                  {r.order.orderNumber} · {r.order.customerName}
                </p>
                <p className="text-xs text-cocoa-muted">{formatDate(r.order.dueDate)} · {r.order.items.length} item(s)</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={r.tier}>{r.tier}</Badge>
                <span className="text-sm font-semibold text-cocoa">{formatCurrency(r.order.total)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
