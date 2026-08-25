import { describe, it, expect } from "vitest";
import {
  resolveBestBy, formatBestBy, wrapLines, computeSnap, NFP_ROWS,
} from "./labelMath";
import type { LabelTemplate } from "../../types";

describe("resolveBestBy", () => {
  it("prefers stored snapshot", () => {
    const l = { bestByDate: "2026-01-15", bestByDays: 7 } as unknown as LabelTemplate;
    expect(resolveBestBy(l, new Date("2026-08-25")).toISOString().slice(0, 10)).toBe("2026-01-15");
  });
  it("computes now + days when no snapshot", () => {
    const l = { bestByDays: 7 } as unknown as LabelTemplate;
    expect(resolveBestBy(l, new Date("2026-08-25")).toISOString().slice(0, 10)).toBe("2026-09-01");
  });
});

describe("formatBestBy", () => {
  it("formats en-US short", () => {
    expect(formatBestBy(new Date(2026, 7, 25))).toBe("Aug 25");
  });
});

describe("wrapLines", () => {
  const measure = (s: string) => s.length; // 1 unit per char
  it("breaks greedily", () => {
    expect(wrapLines("aa bb cc dd", measure, 5)).toEqual(["aa bb", "cc dd"]);
  });
  it("keeps long words intact on their own line", () => {
    expect(wrapLines("aaaaaa bb", measure, 5)).toEqual(["aaaaaa", "bb"]);
  });
  it("returns single empty line for empty text", () => {
    expect(wrapLines("", measure, 5)).toEqual([""]);
  });
});

describe("computeSnap", () => {
  const others = [{ x: 0.5, y: 0.0, w: 0.2, h: 0.2 }];
  it("snaps right edge to neighbor left edge within threshold", () => {
    const r = computeSnap({ x: 0.29, y: 0.05, w: 0.2, h: 0.1 }, others, 0.02);
    expect(r.dx).toBeCloseTo(0.01); // 0.29+0.2=0.49 → snap to 0.5
    expect(r.guidesX).toContain(0.5);
  });
  it("snaps centers", () => {
    const r = computeSnap({ x: 0.41, y: 0.05, w: 0.2, h: 0.1 }, [{ x: 0.4, y: 0, w: 0.2, h: 0.2 }], 0.02);
    // moving center .51 → target center .50 → dx=-.01
    expect(r.dx).toBeCloseTo(-0.01);
  });
  it("no snap beyond threshold", () => {
    const r = computeSnap({ x: 0.2, y: 0.05, w: 0.2, h: 0.1 }, others, 0.02);
    expect(r.dx).toBe(0);
    expect(r.guidesX.length).toBe(0);
  });
});

describe("NFP_ROWS", () => {
  it("covers every NfpData field exactly once", () => {
    const fields = [
      "servingSize","servings","calories","totalFat","satFat","transFat","cholesterol",
      "sodium","totalCarb","fiber","sugars","addedSugars","protein",
      "vitD","calcium","iron","potassium","vitA","vitC",
    ];
    const keys = NFP_ROWS.map((r) => r.key);
    for (const f of fields) expect(keys).toContain(f);
    expect(keys.length).toBe(fields.length);
  });
  it("orders vitamins after protein", () => {
    const idx = (k: string) => NFP_ROWS.findIndex((r) => r.key === k);
    expect(idx("vitD")).toBeGreaterThan(idx("protein"));
  });
});
