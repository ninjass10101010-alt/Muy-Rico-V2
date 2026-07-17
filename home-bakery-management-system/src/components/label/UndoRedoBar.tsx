import { Undo2, Redo2 } from "lucide-react";

interface Props {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export default function UndoRedoBar({ canUndo, canRedo, onUndo, onRedo }: Props) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-1.5 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:cursor-not-allowed disabled:opacity-40"
        title="Undo (Ctrl+Z)"
      >
        <Undo2 size={13} />
        <span className="hidden sm:inline">Undo</span>
        <kbd className="ml-1 rounded bg-sand-100 px-1 font-mono text-[9px] text-cocoa-muted">⌘Z</kbd>
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="flex items-center gap-1 rounded-lg border border-sand-200 px-2.5 py-1.5 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 disabled:cursor-not-allowed disabled:opacity-40"
        title="Redo (Ctrl+Shift+Z)"
      >
        <Redo2 size={13} />
        <span className="hidden sm:inline">Redo</span>
        <kbd className="ml-1 rounded bg-sand-100 px-1 font-mono text-[9px] text-cocoa-muted">⌘⇧Z</kbd>
      </button>
    </div>
  );
}
