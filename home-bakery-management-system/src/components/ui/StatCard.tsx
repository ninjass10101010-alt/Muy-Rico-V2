import type { LucideIcon } from "lucide-react";
import { cn } from "../../utils/cn";

export default function StatCard({
  label,
  value,
  icon: Icon,
  tone = "coral",
  sub,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "coral" | "hibiscus" | "mid-green" | "palm" | "sand";
  sub?: string;
}) {
  const barColors: Record<string, string> = {
    coral: "bg-coral",
    hibiscus: "bg-hibiscus",
    "mid-green": "bg-mid-green",
    palm: "bg-palm",
    sand: "bg-sand-400",
  };
  const iconColors: Record<string, string> = {
    coral: "text-coral",
    hibiscus: "text-hibiscus",
    "mid-green": "text-palm",
    palm: "text-palm",
    sand: "text-cocoa-muted",
  };
  return (
    <div className="group relative overflow-hidden rounded-xl border border-sand-200 bg-sand-50 p-5 shadow-sm transition hover:shadow-md hover:-translate-y-0.5">
      <div className={cn("absolute left-0 top-0 h-full w-1", barColors[tone])} />
      <div className="flex items-center gap-2 pl-1">
        <Icon size={14} className={iconColors[tone]} />
        <p className="text-sm font-medium text-cocoa-muted">{label}</p>
      </div>
      <p className="mt-3 pl-1 font-serif text-2xl font-semibold tracking-tight text-cocoa">{value}</p>
      {sub && <p className="mt-1 pl-1 text-xs text-cocoa-muted">{sub}</p>}
    </div>
  );
}
