import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { BusinessProfile, ComplianceIssue, LabelTemplate } from "../../types";
import { validateLabel } from "../../utils/compliance";

interface Props {
  label: LabelTemplate;
  profile: BusinessProfile;
  onFix: (fieldName: string, value?: string) => void;
  onSelectElement: (id: string) => void;
}

export default function ComplianceChecklist({ label, profile, onFix, onSelectElement }: Props) {
  const { issues } = validateLabel(label, profile);

  const checklist = [
    { id: "biz-name", label: "Business name" },
    { id: "biz-address", label: "Business address" },
    { id: "product-name", label: "Product name" },
    { id: "ingredients", label: "Ingredients list" },
    { id: "allergens", label: "Allergen disclosure" },
    { id: "net-weight", label: "Net weight" },
    { id: "disclaimer-hidden", label: "Disclaimer visibility" },
    { id: "nfp-missing", label: "Nutrition Facts" },
  ];

  function getIssue(id: string): ComplianceIssue | undefined {
    return issues.find((i) => i.id === id);
  }

  return (
    <div className="space-y-1.5">
      {checklist.map((item) => {
        const issue = getIssue(item.id);
        const passed = !issue;
        const isWarning = issue?.severity === "warning";

        return (
          <div
            key={item.id}
            className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs ${
              passed
                ? "border-green-200 bg-green-50"
                : isWarning
                  ? "border-yellow-200 bg-yellow-50"
                  : "border-hibiscus/20 bg-hibiscus-light/10"
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {passed ? (
                <CheckCircle2 size={14} className="shrink-0 text-green-600" />
              ) : isWarning ? (
                <AlertTriangle size={14} className="shrink-0 text-yellow-600" />
              ) : (
                <XCircle size={14} className="shrink-0 text-hibiscus" />
              )}
              <span
                className={`truncate font-medium ${
                  passed ? "text-green-800" : isWarning ? "text-yellow-800" : "text-hibiscus"
                }`}
              >
                {item.label}
              </span>
            </div>

            {issue && issue.fix && (
              <button
                type="button"
                onClick={() => {
                  if (issue.elementId) {
                    onSelectElement(issue.elementId);
                  }
                  onFix(issue.fieldName, issue.fix);
                }}
                className="shrink-0 rounded-md border border-current px-2 py-0.5 text-[10px] font-medium hover:opacity-80"
              >
                Fix It
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
