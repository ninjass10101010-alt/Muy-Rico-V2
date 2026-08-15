import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-coral-light/30 text-coral ring-palm-light",
  "in-progress": "bg-sky-50 text-sky-700 ring-sky-200",
  ready: "bg-violet-50 text-violet-700 ring-violet-200",
  completed: "bg-mid-green-light/20 text-palm ring-mid-green-light",
  cancelled: "bg-hibiscus-light/20 text-hibiscus ring-hibiscus-light",
  paid: "bg-mid-green-light/20 text-palm ring-mid-green-light",
  unpaid: "bg-hibiscus-light/20 text-hibiscus ring-hibiscus-light",
  partial: "bg-coral-light/30 text-coral ring-palm-light",
  website: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  "in-person": "bg-orange-50 text-orange-700 ring-orange-200",
  low: "bg-hibiscus-light/20 text-hibiscus ring-hibiscus-light",
  ok: "bg-mid-green-light/20 text-palm ring-mid-green-light",
  new: "bg-coral-light/30 text-coral ring-palm-light",
  replied: "bg-mid-green-light/20 text-palm ring-mid-green-light",
  converted: "bg-palm-50 text-palm ring-palm/30",
  archived: "bg-sand-100 text-cocoa-muted ring-sand-200",
  overdue: "bg-hibiscus/10 text-hibiscus ring-hibiscus/30",
  out: "bg-hibiscus text-white ring-hibiscus",
  today: "bg-coral-light/30 text-coral ring-coral/30",
  tomorrow: "bg-coral-light/20 text-coral ring-coral/20",
  "this-week": "bg-sand-100 text-cocoa-muted ring-sand-200",
};

export default function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const style = (tone && STATUS_STYLES[tone]) || "bg-sand-100 text-cocoa-muted ring-sand-200";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium capitalize ring-1 ring-inset",
        style,
      )}
    >
      {children}
    </span>
  );
}
