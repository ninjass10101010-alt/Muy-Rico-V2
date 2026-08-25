import { create } from "zustand";
import type { LabelElement, LabelTemplate } from "../../types";
import { pushHistory, undoHistory, redoHistory } from "./history";
import { normalizeLabel } from "./templateUtils";
import { ensureElements } from "../../components/label/defaultElements";

export type LeftTab = "add" | "layers" | "templates";

interface EditorState {
  doc: LabelTemplate;
  past: LabelTemplate[];
  future: LabelTemplate[];
  selection: string | null;
  editingId: string | null;
  zoom: number; // percent, 25..400
  panX: number;
  panY: number;
  leftTab: LeftTab;
  complianceOpen: boolean;
  dirty: boolean;

  loadTemplate(t: LabelTemplate): void;
  setDoc(next: LabelTemplate, record?: boolean): void;
  updateField<K extends keyof LabelTemplate>(key: K, value: LabelTemplate[K], record?: boolean): void;
  setElements(elements: LabelElement[], record?: boolean): void;
  patchElement(id: string, patch: Partial<LabelElement>, record?: boolean): void;
  select(id: string | null): void;
  setEditingId(id: string | null): void;
  setZoom(z: number): void;
  setPan(x: number, y: number): void;
  setLeftTab(tab: LeftTab): void;
  toggleCompliance(): void;
  undo(): void;
  redo(): void;
  markClean(): void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  doc: normalizeLabel({ id: "boot", name: "…" } as unknown as LabelTemplate, ""),
  past: [],
  future: [],
  selection: null,
  editingId: null,
  zoom: 100,
  panX: 0,
  panY: 0,
  leftTab: "add",
  complianceOpen: false,
  dirty: false,

  loadTemplate: (t) =>
    set({
      doc: normalizeLabel(t, ""),
      past: [],
      future: [],
      selection: null,
      editingId: null,
      zoom: 100,
      panX: 0,
      panY: 0,
      dirty: false,
    }),

  setDoc: (next, record = true) =>
    set((s) => ({
      doc: next,
      past: record ? pushHistory(s.past, s.doc) : s.past,
      future: record ? [] : s.future,
      dirty: true,
    })),

  updateField: (key, value, record = true) =>
    get().setDoc({ ...get().doc, [key]: value }, record),

  setElements: (elements, record = true) =>
    get().setDoc({ ...get().doc, elements: [...elements].sort((a, b) => a.z - b.z) }, record),

  patchElement: (id, patch, record = true) =>
    get().setElements(
      get().doc.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      record
    ),

  select: (id) => set({ selection: id, editingId: null }),
  setEditingId: (id) => set({ editingId: id }),
  setZoom: (zoom) => set({ zoom: Math.min(400, Math.max(25, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setLeftTab: (leftTab) => set({ leftTab }),
  toggleCompliance: () => set((s) => ({ complianceOpen: !s.complianceOpen })),

  undo: () =>
    set((s) => {
      const r = undoHistory(s.doc, s.past, s.future);
      return r ? { doc: r.doc, past: r.past, future: r.future, dirty: true } : {};
    }),

  redo: () =>
    set((s) => {
      const r = redoHistory(s.doc, s.past, s.future);
      return r ? { doc: r.doc, past: r.past, future: r.future, dirty: true } : {};
    }),

  markClean: () => set({ dirty: false }),
}));

export const selectCanUndo = (s: EditorState) => s.past.length > 0;
export const selectCanRedo = (s: EditorState) => s.future.length > 0;
export const selectElements = (s: EditorState) => ensureElements(s.doc);
export const selectSortedElements = (s: EditorState) =>
  [...ensureElements(s.doc)].sort((a, b) => a.z - b.z);
export const selectSelected = (s: EditorState) =>
  ensureElements(s.doc).find((e) => e.id === s.selection) || null;
