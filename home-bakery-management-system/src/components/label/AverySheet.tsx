import { Printer, Grid3x3 } from "lucide-react";

interface Props {
  averyPreset: "single" | "5164" | "5163" | "8163";
  onChange: (p: string) => void;
  onPrint: (preset: string) => void;
}

const PRESETS: { value: string; label: string; cols: number; rows: number }[] = [
  { value: "single", label: "Single label", cols: 1, rows: 1 },
  { value: "5164", label: "Avery 5164 (2×3)", cols: 2, rows: 3 },
  { value: "5163", label: "Avery 5163 (2×4)", cols: 2, rows: 4 },
  { value: "8163", label: "Avery 8163 (2×4)", cols: 2, rows: 4 },
];

export default function AverySheet({ averyPreset, onChange, onPrint }: Props) {
  const current = PRESETS.find((p) => p.value === averyPreset) || PRESETS[0];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => onChange(p.value)}
            className={`flex items-center gap-2 rounded-lg border px-2 py-2 text-xs font-medium ${
              averyPreset === p.value
                ? "border-palm bg-palm text-white"
                : "border-sand-200 text-cocoa-muted"
            }`}
          >
            <Grid3x3 size={14} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      {averyPreset !== "single" && (
        <div className="flex items-center justify-center gap-1 rounded-lg border border-sand-200 bg-sand-50 p-3">
          {Array.from({ length: current.rows }).map((_, r) => (
            <div key={r} className="flex flex-col gap-1">
              {Array.from({ length: current.cols }).map((_, c) => (
                <div
                  key={c}
                  className="h-6 w-6 rounded border border-sand-300 bg-white"
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => onPrint(averyPreset)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-sand-300 px-3 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
      >
        <Printer size={14} />
        Print
      </button>
    </div>
  );
}
