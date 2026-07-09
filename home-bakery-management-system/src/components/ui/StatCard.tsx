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
  const tones: Record<string, string> = {
    coral: "bg-coral-light/30 text-coral",
    hibiscus: "bg-hibiscus-light/20 text-hibiscus",
    "mid-green": "bg-mid-green-light/20 text-palm",
    palm: "bg-palm/10 text-palm",
    sand: "bg-sand-200 text-cocoa-muted",
  };
  return (
    <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-cocoa-muted">{label}</p>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", tones[tone])}>
          <Icon size={18} />
        </div>
      </div>
      <p className="mt-3 font-serif text-2xl font-semibold tracking-tight text-cocoa">{value}</p>
      {sub && <p className="mt-1 text-xs text-cocoa-muted">{sub}</p>}
    </div>
  );
}
