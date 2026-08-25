import { useMemo } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import type { LabelElement } from "../../../types";
import { ELEMENT_LABELS } from "../../../components/label/defaultElements";
import { selectSortedElements, useEditorStore } from "../state";

export default function LayersTab() {
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const patchElement = useEditorStore((s) => s.patchElement);
  const updateField = useEditorStore((s) => s.updateField);
  const select = useEditorStore((s) => s.select);
  const setElements = useEditorStore((s) => s.setElements);

  // Top-first = highest z first. selectSortedElements returns a fresh array on
  // every call, so memoize against doc (never use it as a live store selector).
  const sorted = useMemo(() => selectSortedElements(useEditorStore.getState()), [doc]);
  const display = [...sorted].reverse();

  function toggleHide(el: LabelElement) {
    const hidden = !el.hidden;
    if (el.field === "disclaimer") updateField("showDisclaimer", !hidden);
    patchElement(el.id, { hidden });
  }

  function toggleLock(el: LabelElement) {
    patchElement(el.id, { lock: !el.lock });
  }

  function move(id: string, dir: -1 | 1) {
    const idx = display.findIndex((e) => e.id === id);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= display.length) return;
    const a = display[idx];
    const b = display[target];
    const next = sorted.map((e) =>
      e.id === a.id ? { ...e, z: b.z } : e.id === b.id ? { ...e, z: a.z } : e
    );
    setElements(next);
  }

  return (
    <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
      {display.length === 0 && (
        <p className="py-4 text-center text-xs text-cocoa-muted">No elements on this label.</p>
      )}
      {display.map((el, idx) => (
        <div
          key={el.id}
          className={`flex items-center gap-0.5 rounded-lg border py-0.5 pl-1 pr-0.5 transition ${
            selection === el.id ? "border-coral bg-coral-light/20" : "border-sand-200"
          }`}
        >
          <button
            type="button"
            onClick={() => select(el.id)}
            className="flex min-h-11 flex-1 items-center truncate px-1 text-left text-xs font-medium text-cocoa-muted"
          >
            <span className="truncate">{(el.field && ELEMENT_LABELS[el.field]) || el.field || el.type}</span>
          </button>
          <button
            type="button"
            title={el.hidden ? "Show" : "Hide"}
            onClick={() => toggleHide(el)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-cocoa-muted transition hover:bg-sand-50 hover:text-cocoa"
          >
            {el.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            title={el.lock ? "Unlock" : "Lock"}
            onClick={() => toggleLock(el)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-cocoa-muted transition hover:bg-sand-50 hover:text-cocoa"
          >
            {el.lock ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button
            type="button"
            title="Move up (front)"
            disabled={idx === 0}
            onClick={() => move(el.id, -1)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-l-md text-cocoa-muted transition hover:bg-sand-50 hover:text-cocoa disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            title="Move down (back)"
            disabled={idx === display.length - 1}
            onClick={() => move(el.id, 1)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-r-md text-cocoa-muted transition hover:bg-sand-50 hover:text-cocoa disabled:cursor-not-allowed disabled:opacity-30"
          >
            <ArrowDown size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
