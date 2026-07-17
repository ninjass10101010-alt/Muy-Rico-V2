import { BookOpen, ExternalLink } from "lucide-react";
import * as Law from "../../utils/miLaw";

export default function MILawReference() {
  return (
    <details className="group rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-4 shadow-sm">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cocoa-muted">
        <BookOpen size={14} />
        Michigan Cottage Food Law Reference
      </summary>
      <div className="mt-3 space-y-3 text-xs text-cocoa">
        <div>
          <p className="mb-1 font-medium text-cocoa-muted">Allowed foods</p>
          <ul className="list-inside list-disc space-y-0.5 text-cocoa-muted">
            {Law.ALLOWED_FOODS.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1 font-medium text-cocoa-muted">Sales limits</p>
          <p className="text-cocoa-muted">{Law.SALES_LIMITS}</p>
        </div>

        <div>
          <p className="mb-1 font-medium text-cocoa-muted">Sales channels</p>
          <ul className="list-inside list-disc space-y-0.5 text-cocoa-muted">
            {Law.SALES_CHANNELS.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-1">
          <a
            href={Law.MSU_REGISTRATION_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-coral underline"
          >
            MSU Product Center Registration <ExternalLink size={10} />
          </a>
          <p className="text-cocoa-muted">
            MDARD: {Law.MDARD_PHONE} &middot; {Law.MDARD_EMAIL}
          </p>
          <a
            href={Law.MCL_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-coral underline"
          >
            Michigan Compiled Law MCL 289.4102 <ExternalLink size={10} />
          </a>
          <a
            href={Law.FDA_NFP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-coral underline"
          >
            FDA Nutrition Facts Label <ExternalLink size={10} />
          </a>
        </div>
      </div>
    </details>
  );
}
