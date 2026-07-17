import { AlertTriangle, ArrowUp } from "lucide-react";
import type { LabelTemplate } from "../../types";
import { cqwToPt, ptToCqw } from "../../utils/compliance";
import { ELEMENT_LABELS } from "./defaultElements";

interface Props {
  label: LabelTemplate;
  effW: number;
  onFix: (elementId: string, newSizeCqw: number) => void;
}

export default function FontCompliancePanel({ label, effW, onFix }: Props) {
  const underMin = label.elements
    .map((el) => {
      const cqw = el.fontSizeOverride ?? 4;
      const pt = cqwToPt(cqw, effW);
      const floor = el.field === "disclaimer" ? 11 : 4.5;
      return { el, cqw, pt, floor, needsFix: pt < floor };
    })
    .filter(({ needsFix }) => needsFix);

  if (underMin.length === 0) {
    return (
      <p className="text-xs text-green-700">All element font sizes meet minimum requirements.</p>
    );
  }

  return (
    <div className="space-y-1.5">
      {underMin.map(({ el, pt, floor }) => (
        <div
          key={el.id}
          className="flex items-center justify-between gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-2.5 py-2 text-xs"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <AlertTriangle size={14} className="shrink-0 text-yellow-600" />
            <span className="truncate font-medium text-yellow-800">
              {ELEMENT_LABELS[el.field] || el.field}
            </span>
            <span className="shrink-0 text-yellow-600">
              {pt.toFixed(1)}pt / {floor}pt min
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const newCqw = ptToCqw(floor, effW);
              onFix(el.id, newCqw);
            }}
            className="flex shrink-0 items-center gap-1 rounded-md border border-current px-2 py-0.5 text-[10px] font-medium text-yellow-700 hover:opacity-80"
          >
            <ArrowUp size={10} />
            Fix
          </button>
        </div>
      ))}
    </div>
  );
}
