import { CheckCircle2 } from "lucide-react";
import type { BusinessProfile, LabelTemplate } from "../../types";
import { validateLabel } from "../../utils/compliance";

interface Props {
  label: LabelTemplate;
  profile: BusinessProfile;
}

export default function ComplianceScore({ label, profile }: Props) {
  const { score, isCompliant } = validateLabel(label, profile);

  const colorClass =
    score < 50
      ? "bg-coral/20 text-coral"
      : score < 80
        ? "bg-yellow-100 text-yellow-700"
        : "bg-green-100 text-green-700";

  return (
    <div className="flex items-center gap-2">
      <span className={`rounded-full px-3 py-1 text-xs font-bold ${colorClass}`}>
        {score}%
      </span>
      {isCompliant && (
        <span className="flex items-center gap-1 text-xs font-medium text-green-700">
          <CheckCircle2 size={14} />
          Ready to Print
        </span>
      )}
    </div>
  );
}
