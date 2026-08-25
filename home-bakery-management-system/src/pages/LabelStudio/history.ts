import type { LabelTemplate } from "../../types";

export const HISTORY_CAP = 100;

export function pushHistory(
  past: LabelTemplate[],
  doc: LabelTemplate,
  cap: number = HISTORY_CAP
): LabelTemplate[] {
  const next = [...past, doc];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function undoHistory(
  doc: LabelTemplate,
  past: LabelTemplate[],
  future: LabelTemplate[]
): { doc: LabelTemplate; past: LabelTemplate[]; future: LabelTemplate[] } | null {
  if (past.length === 0) return null;
  return {
    doc: past[past.length - 1],
    past: past.slice(0, -1),
    future: [...future, doc],
  };
}

export function redoHistory(
  doc: LabelTemplate,
  past: LabelTemplate[],
  future: LabelTemplate[]
): { doc: LabelTemplate; past: LabelTemplate[]; future: LabelTemplate[] } | null {
  if (future.length === 0) return null;
  return {
    doc: future[future.length - 1],
    past: [...past, doc],
    future: future.slice(0, -1),
  };
}
