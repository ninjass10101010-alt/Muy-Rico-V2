import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import type { BusinessProfile, ComplianceIssue, LabelTemplate } from "../../types";
import { validateLabel } from "../../utils/compliance";

interface Props {
  label: LabelTemplate;
  profile: BusinessProfile;
  onFix: (issueId: string, fieldName: string, elementId?: string) => void;
  onSelectElement: (id: string) => void;
}

export default function ComplianceChecklist({ label, profile, onFix, onSelectElement }: Props) {
  const { issues } = validateLabel(label, profile);

  const checklist = [
    { id: "biz-name", label: "Business name" },
    { id: "biz-address", label: "Business address" },
    { id: "biz-pobox", label: "No P.O. Box" },
    { id: "product-name", label: "Product name" },
    { id: "ingredients", label: "Ingredients list" },
    { id: "allergens", label: "Allergen disclosure" },
    { id: "net-weight", label: "Net weight" },
    { id: "disclaimer-hidden", label: "Disclaimer visibility" },
    { id: "disclaimer-font", label: "Disclaimer font size" },
    { id: "disclaimer-contrast", label: "Disclaimer contrast" },
    { id: "nfp-missing", label: "Nutrition Facts" },
  ];

  function getIssue(id: string): ComplianceIssue | undefined {
    return issues.find((i) => i.id === id);
  }

  // Only show rows that are either always-tracked, or currently failing
  const alwaysShow = new Set([
    "biz-name",
    "biz-address",
    "product-name",
    "ingredients",
    "allergens",
    "net-weight",
    "disclaimer-hidden",
    "nfp-missing",
  ]);

  const rows = checklist.filter((item) => alwaysShow.has(item.id) || getIssue(item.id));

  return (
    <div className="space-y-1.5">
      {rows.map((item) => {
        const issue = getIssue(item.id);
        // biz-address and biz-pobox both map to address check — if neither issue, address passes
        const passed =
          item.id === "biz-address"
            ? !getIssue("biz-address") && !getIssue("biz-pobox")
            : item.id === "biz-pobox"
              ? !getIssue("biz-pobox")
              : !issue;
        const isWarning = issue?.severity === "warning";
        const showFix = issue && issue.severity === "error";

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

            {showFix && (
              <button
                type="button"
                onClick={() => {
                  if (issue.elementId) onSelectElement(issue.elementId);
                  onFix(issue.id, issue.fieldName, issue.elementId);
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
