import type { LucideIcon } from "lucide-react";
import { cn } from "../../utils/cn";

interface Trend {
  pctDelta: number;
  spark?: number[];
}

interface Cta {
  label: string;
  onClick: () => void;
}

export default function StatCard({
  label,
  value,
  icon: Icon,
  tone = "coral",
  sub,
  trend,
  cta,
  onClick,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "coral" | "hibiscus" | "mid-green" | "palm" | "sand";
  sub?: string;
  trend?: Trend;
  cta?: Cta;
  onClick?: () => void;
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
  const sparkColors: Record<string, string> = {
    coral: "#f7a8a4",
    hibiscus: "#c0573a",
    "mid-green": "#2E7D32",
    palm: "#1e4636",
    sand: "#a8967a",
  };

  const showTrendDelta = trend && Number.isFinite(trend.pctDelta) && trend.pctDelta !== 0;
  const deltaUp = showTrendDelta && (trend!.pctDelta > 0);

  const Card = onClick ? "button" : "div";

  return (
    <Card
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group relative w-full overflow-hidden rounded-2xl border border-sand-200 bg-sand-50 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        "shadow-[0_8px_24px_-12px_rgba(30,70,54,0.18)]",
        onClick && "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-palm/40 focus-visible:ring-offset-2",
      )}
    >
      <div className={cn("absolute left-0 top-0 h-full w-1", barColors[tone])} />
      <div className="flex items-start justify-between gap-2 pl-1">
        <div className="flex items-center gap-2">
          <Icon size={14} className={iconColors[tone]} />
          <p className="text-sm font-medium text-cocoa-muted">{label}</p>
        </div>
        {trend && trend.spark && trend.spark.length >= 2 && (
          <Sparkline data={trend.spark} color={sparkColors[tone]} />
        )}
      </div>
      <p className="mt-3 pl-1 font-serif text-2xl font-semibold tracking-tight text-cocoa">{value}</p>
      {showTrendDelta ? (
        <p className={cn("mt-1 pl-1 text-xs font-medium", deltaUp ? "text-mid-green" : "text-hibiscus")}>
          {deltaUp ? "▲" : "▼"} {Math.abs(trend!.pctDelta).toFixed(0)}% vs last month
        </p>
      ) : sub ? (
        <p className="mt-1 pl-1 text-xs text-cocoa-muted">{sub}</p>
      ) : null}
      {cta && (
        <div className="mt-3 pl-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); cta.onClick(); }}
            className="text-xs font-medium text-coral hover:underline"
          >
            {cta.label} →
          </button>
        </div>
      )}
    </Card>
  );
}

function Sparkline({ data, color, w = 64, h = 16 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  if (max === min) return null;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / (max - min)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
