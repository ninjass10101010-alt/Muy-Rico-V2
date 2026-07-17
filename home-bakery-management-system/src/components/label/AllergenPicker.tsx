import { Sparkles } from "lucide-react";
import {
  FDA_ALLERGENS,
  TREE_NUT_SUB,
  SHELLFISH_SUB,
  detectAllergens,
  renderContainsLine,
} from "../../utils/compliance";

interface Props {
  value: string[];
  noAllergensConfirmed: boolean;
  onChange: (tags: string[]) => void;
  onNoAllergens: (v: boolean) => void;
  ingredientsText: string;
}

export default function AllergenPicker({
  value,
  noAllergensConfirmed,
  onChange,
  onNoAllergens,
  ingredientsText,
}: Props) {
  function toggle(tag: string) {
    if (value.includes(tag)) {
      onChange(value.filter((t) => t !== tag));
    } else {
      onChange([...value, tag]);
    }
  }

  function toggleSub(category: string, sub: string) {
    const prefix = `${category}: ${sub}`;
    if (value.includes(prefix)) {
      onChange(value.filter((t) => t !== prefix));
    } else {
      onChange([...value, prefix]);
    }
  }

  function isSubChecked(category: string, sub: string) {
    return value.includes(`${category}: ${sub}`);
  }

  const hasTreeNuts = value.includes("Tree Nuts");
  const hasShellfish = value.includes("Crustacean Shellfish");

  const containsLine = renderContainsLine(value);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        {FDA_ALLERGENS.map((a) => (
          <label
            key={a}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-sand-200 px-2.5 py-2 text-xs transition hover:bg-sand-50 has-checked:border-coral has-checked:bg-coral-light/20"
          >
            <input
              type="checkbox"
              checked={value.includes(a)}
              onChange={() => toggle(a)}
              disabled={noAllergensConfirmed}
              className="accent-coral"
            />
            {a}
          </label>
        ))}
      </div>

      {hasTreeNuts && (
        <div className="ml-4 space-y-1 rounded-lg border border-sand-200 bg-sand-50 p-2">
          <p className="text-[10px] font-medium text-cocoa-muted">Tree nut varieties:</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {TREE_NUT_SUB.map((tn) => (
              <label
                key={tn}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-cocoa-muted"
              >
                <input
                  type="checkbox"
                  checked={isSubChecked("Tree Nuts", tn)}
                  onChange={() => toggleSub("Tree Nuts", tn)}
                  disabled={noAllergensConfirmed}
                  className="accent-coral"
                />
                {tn}
              </label>
            ))}
          </div>
        </div>
      )}

      {hasShellfish && (
        <div className="ml-4 space-y-1 rounded-lg border border-sand-200 bg-sand-50 p-2">
          <p className="text-[10px] font-medium text-cocoa-muted">Shellfish varieties:</p>
          <div className="flex flex-wrap gap-3">
            {SHELLFISH_SUB.map((s) => (
              <label
                key={s}
                className="flex cursor-pointer items-center gap-1.5 text-xs text-cocoa-muted"
              >
                <input
                  type="checkbox"
                  checked={isSubChecked("Crustacean Shellfish", s)}
                  onChange={() => toggleSub("Crustacean Shellfish", s)}
                  disabled={noAllergensConfirmed}
                  className="accent-coral"
                />
                {s}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            const detected = detectAllergens(ingredientsText);
            onChange(detected);
            if (detected.length > 0) onNoAllergens(false);
          }}
          className="flex items-center gap-1 rounded-lg border border-sand-300 px-2.5 py-1.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
        >
          <Sparkles size={12} />
          Auto-derive from ingredients
        </button>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-xs text-cocoa-muted">
        <input
          type="checkbox"
          checked={noAllergensConfirmed}
          onChange={(e) => {
            const checked = e.target.checked;
            onNoAllergens(checked);
            if (checked) onChange([]);
          }}
          className="accent-coral"
        />
        No major allergens
      </label>

      {containsLine && (
        <p className="rounded-lg bg-sand-100 px-2.5 py-1.5 text-[11px] italic text-cocoa-muted">
          {containsLine}
        </p>
      )}
    </div>
  );
}
