import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import type { LabelElement } from "../../types";
import { ELEMENT_LABELS } from "./defaultElements";

interface Props {
  elements: LabelElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleHide: (id: string) => void;
  onToggleLock: (id: string) => void;
  onReorder?: (elementIds: string[]) => void;
}

export default function LayersPanel({
  elements,
  selectedId,
  onSelect,
  onToggleHide,
  onToggleLock,
  onReorder,
}: Props) {
  const sorted = [...elements].sort((a, b) => b.z - a.z);

  function handleDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId || !onReorder) return;

    const ids = sorted.map((el) => el.id);
    const srcIdx = ids.indexOf(sourceId);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    ids.splice(srcIdx, 1);
    ids.splice(tgtIdx, 0, sourceId);
    onReorder(ids);
  }

  return (
    <div className="max-h-56 space-y-1 overflow-y-auto">
      {sorted.map((el) => (
        <div
          key={el.id}
          draggable
          onDragStart={(e) => handleDragStart(e, el.id)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, el.id)}
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs ${
            selectedId === el.id
              ? "border-coral bg-coral-light/20"
              : "border-sand-200"
          } cursor-grab active:cursor-grabbing`}
        >
          <button
            type="button"
            onClick={() => onSelect(el.id)}
            className="flex-1 truncate text-left font-medium text-cocoa-muted"
          >
            {ELEMENT_LABELS[el.field] || el.field}
          </button>
          <button
            type="button"
            title={el.hidden ? "Show" : "Hide"}
            onClick={() => onToggleHide(el.id)}
            className="text-cocoa-muted hover:text-cocoa"
          >
            {el.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            type="button"
            title={el.lock ? "Unlock" : "Lock"}
            onClick={() => onToggleLock(el.id)}
            className="text-cocoa-muted hover:text-cocoa"
          >
            {el.lock ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
        </div>
      ))}
    </div>
  );
}
