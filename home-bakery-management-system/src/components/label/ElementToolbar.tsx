import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Lock, Unlock, Trash2 } from "lucide-react";
import type { LabelElement } from "../../types";

interface Props {
  el: LabelElement;
  onBringFront: () => void;
  onSendBack: () => void;
  onDuplicate: () => void;
  onToggleHide: () => void;
  onToggleLock: () => void;
  onDelete: () => void;
  canDelete: boolean;
}

export default function ElementToolbar({
  el,
  onBringFront,
  onSendBack,
  onDuplicate,
  onToggleHide,
  onToggleLock,
  onDelete,
  canDelete,
}: Props) {
  return (
    <div className="deco-layer flex items-center gap-0.5 rounded-lg border border-sand-200 bg-white px-1 py-0.5 shadow-md">
      <Btn title="Bring to front" onClick={onBringFront}><ArrowUp size={13} /></Btn>
      <Btn title="Send to back" onClick={onSendBack}><ArrowDown size={13} /></Btn>
      <Btn title="Duplicate" onClick={onDuplicate}><Copy size={13} /></Btn>
      <Btn title={el.hidden ? "Show" : "Hide"} onClick={onToggleHide}>
        {el.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
      </Btn>
      <Btn title={el.lock ? "Unlock" : "Lock"} onClick={onToggleLock}>
        {el.lock ? <Unlock size={13} /> : <Lock size={13} />}
      </Btn>
      {canDelete && (
        <Btn title="Delete" onClick={onDelete} danger>
          <Trash2 size={13} />
        </Btn>
      )}
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
