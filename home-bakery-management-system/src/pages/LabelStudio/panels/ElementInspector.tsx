import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Lock, Trash2, Unlock } from "lucide-react";
import type { LabelElement } from "../../../types";
import PropertiesInspector from "../../../components/label/PropertiesInspector";
import { ELEMENT_LABELS } from "../../../components/label/defaultElements";
import { newId } from "../../../utils/format";
import { useEditorStore } from "../state";

/** Quick actions + properties for the selected element. */
export default function ElementInspector({ el }: { el: LabelElement }) {
  const doc = useEditorStore((s) => s.doc);
  const patchElement = useEditorStore((s) => s.patchElement);
  const setElements = useEditorStore((s) => s.setElements);
  const setDoc = useEditorStore((s) => s.setDoc);
  const select = useEditorStore((s) => s.select);

  function bringFront() {
    const maxZ = doc.elements.reduce((m, e) => Math.max(m, e.z), 0);
    patchElement(el.id, { z: maxZ + 1 });
  }

  function sendBack() {
    const minZ = doc.elements.reduce((m, e) => Math.min(m, e.z), 0);
    patchElement(el.id, { z: minZ - 1 });
  }

  function duplicate() {
    const copy: LabelElement = {
      ...el,
      id: newId("el"),
      x: Math.min(el.x + 0.03, 1 - el.w),
      y: Math.min(el.y + 0.03, 1 - el.h),
      z: el.z + 1,
    };
    setElements([...doc.elements, copy]);
    select(copy.id);
  }

  function toggleHide() {
    const hidden = !el.hidden;
    if (el.field === "disclaimer") {
      // Sync doc flag + element visibility in a single history entry.
      setDoc({
        ...doc,
        showDisclaimer: !hidden,
        elements: doc.elements.map((e) => (e.id === el.id ? { ...e, hidden } : e)),
      });
    } else {
      patchElement(el.id, { hidden });
    }
  }

  function toggleLock() {
    patchElement(el.id, { lock: !el.lock });
  }

  function deleteEl() {
    if (el.field === "disclaimer") return;
    setElements(doc.elements.filter((e) => e.id !== el.id));
    select(null);
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-cocoa-muted">
          {(el.field && ELEMENT_LABELS[el.field]) || el.field || el.type}
        </p>
        <span className="text-[10px] text-cocoa-muted">Selected element</span>
      </div>
      <div className="deco-layer flex items-center gap-0.5 rounded-lg border border-sand-200 bg-white px-1 py-0.5 shadow-md">
        <Btn title="Bring to front" onClick={bringFront}><ArrowUp size={13} /></Btn>
        <Btn title="Send to back" onClick={sendBack}><ArrowDown size={13} /></Btn>
        <Btn title="Duplicate" onClick={duplicate}><Copy size={13} /></Btn>
        <Btn title={el.hidden ? "Show" : "Hide"} onClick={toggleHide}>
          {el.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
        </Btn>
        <Btn title={el.lock ? "Unlock" : "Lock"} onClick={toggleLock}>
          {el.lock ? <Unlock size={13} /> : <Lock size={13} />}
        </Btn>
        {el.field !== "disclaimer" && (
          <Btn title="Delete" onClick={deleteEl} danger>
            <Trash2 size={13} />
          </Btn>
        )}
      </div>
      <PropertiesInspector
        el={el}
        label={doc}
        onChange={(patch) => patchElement(el.id, patch)}
      />
    </div>
  );
}

function Btn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded p-1.5 transition hover:bg-sand-100 ${
        danger ? "text-hibiscus" : "text-cocoa-muted"
      }`}
    >
      {children}
    </button>
  );
}
