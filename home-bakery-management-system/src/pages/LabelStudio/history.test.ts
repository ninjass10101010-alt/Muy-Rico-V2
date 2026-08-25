import { describe, it, expect } from "vitest";
import { pushHistory, undoHistory, redoHistory } from "./history";
import type { LabelTemplate } from "../../types";

const doc = (n: string): LabelTemplate => ({ id: n, name: n }) as unknown as LabelTemplate;

describe("history", () => {
  it("caps past length at 100", () => {
    let past: LabelTemplate[] = [];
    for (let i = 0; i < 120; i++) past = pushHistory(past, doc(`d${i}`));
    expect(past.length).toBe(100);
    expect(past[0].id).toBe("d20");
  });

  it("undo pops last past entry into future", () => {
    const past = [doc("a")];
    const cur = doc("b");
    const r = undoHistory(cur, past, []);
    expect(r!.doc.id).toBe("a");
    expect(r!.past.length).toBe(0);
    expect(r!.future.length).toBe(1);
    expect(r!.future[0].id).toBe("b");
  });

  it("undo returns null when nothing to undo", () => {
    expect(undoHistory(doc("a"), [], [])).toBeNull();
  });

  it("redo mirrors undo", () => {
    const cur = doc("a");
    const future = [doc("b")];
    const r = redoHistory(cur, [], future);
    expect(r!.doc.id).toBe("b");
    expect(r!.past.map((d) => d.id)).toEqual(["a"]);
    expect(r!.future.length).toBe(0);
  });
});
