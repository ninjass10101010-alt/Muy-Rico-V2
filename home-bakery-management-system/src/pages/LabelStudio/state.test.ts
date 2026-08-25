import { describe, it, expect, beforeEach } from "vitest";
import { useEditorStore } from "./state";
import { makeFallback } from "./templateUtils";
import type { LabelElement } from "../../types";

function el(id: string, over: Partial<LabelElement> = {}): LabelElement {
  return { id, type: "text", x: 0.1, y: 0.1, w: 0.3, h: 0.1, z: 1, ...over };
}

describe("editor store", () => {
  beforeEach(() => {
    useEditorStore.getState().loadTemplate(makeFallback(""));
    useEditorStore.getState().setElements([el("a", { z: 2 }), el("b", { z: 1 })]);
    useEditorStore.getState().markClean();
  });

  it("patchElement records exactly one history entry", () => {
    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().patchElement("a", { x: 0.5 });
    const s = useEditorStore.getState();
    expect(s.past.length).toBe(before + 1);
    expect(s.doc.elements.find((e) => e.id === "a")!.x).toBe(0.5);
    expect(s.dirty).toBe(true);
  });

  it("record=false mutates without history (gesture frames)", () => {
    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().patchElement("a", { y: 0.4 }, false);
    const s = useEditorStore.getState();
    expect(s.past.length).toBe(before);
    expect(s.doc.elements.find((e) => e.id === "a")!.y).toBe(0.4);
  });

  it("sorted elements ascend by z", () => {
    expect(useEditorStore.getState().doc.elements.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("undo/redo round-trips a patch", () => {
    useEditorStore.getState().patchElement("a", { x: 0.7 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().doc.elements.find((e) => e.id === "a")!.x).toBe(0.1);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().doc.elements.find((e) => e.id === "a")!.x).toBe(0.7);
  });

  it("new edit invalidates redo stack", () => {
    useEditorStore.getState().patchElement("a", { x: 0.7 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().future.length).toBe(1);
    useEditorStore.getState().patchElement("a", { x: 0.9 });
    expect(useEditorStore.getState().future.length).toBe(0);
  });

  it("loadTemplate normalizes legacy templates", () => {
    useEditorStore.getState().loadTemplate({ id: "x", name: "MR-123" } as never);
    const s = useEditorStore.getState();
    expect(s.doc.templateKind).toBe("order");
    expect(s.doc.orientation).toBe("portrait");
    expect(s.doc.elements.length).toBeGreaterThan(0);
  });
});
