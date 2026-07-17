import { Info } from "lucide-react";
import type { ProductType } from "../../types";

interface Props {
  value: ProductType;
  onChange: (v: ProductType) => void;
}

const TYPES: { value: ProductType; label: string }[] = [
  { value: "standard", label: "Standard Cottage Food" },
  { value: "maple", label: "Maple Syrup" },
  { value: "honey", label: "Honey" },
  { value: "wedding", label: "Wedding/Specialty Cake" },
];

export default function ProductTypeSelector({ value, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={`rounded-lg border px-2 py-2 text-xs font-medium ${
              value === t.value
                ? "border-palm bg-palm text-white"
                : "border-sand-200 text-cocoa-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {value === "wedding" && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <Info size={14} className="mt-0.5 shrink-0" />
          <p>
            For cakes not easily packaged, all label fields must appear on the invoice delivered
            with the cake.
          </p>
        </div>
      )}
    </div>
  );
}
