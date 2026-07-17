import { Square, Minus } from "lucide-react";
import type { LabelElement } from "../../types";

interface Props {
  onAdd: (type: LabelElement["type"]) => void;
}

const SHAPES: { type: LabelElement["type"]; label: string; icon: React.ReactNode }[] = [
  { type: "rect", label: "Rectangle", icon: <Square size={14} /> },
  { type: "line", label: "Line", icon: <Minus size={14} /> },
];

export default function ShapePalette({ onAdd }: Props) {
  return (
    <div className="flex gap-2">
      {SHAPES.map((s) => (
        <button
          key={s.type}
          type="button"
          onClick={() => onAdd(s.type)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-sand-300 px-2 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
        >
          {s.icon}
          {s.label}
        </button>
      ))}
    </div>
  );
}
