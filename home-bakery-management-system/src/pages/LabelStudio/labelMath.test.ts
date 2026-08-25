import { describe, it, expect } from "vitest";
import {
  resolveBestBy, formatBestBy, wrapLines, computeSnap, NFP_ROWS, effectiveText,
} from "./labelMath";
import type { BusinessProfile, LabelElement, LabelTemplate } from "../../types";

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

describe("effectiveText", () => {
  const el = (field: string) =>
    ({ id: "e1", type: "text", field, x: 0, y: 0, w: 0.2, h: 0.05, z: 0 }) as unknown as LabelElement;
  const baseLabel = {
    showPrice: false,
    showBestBy: false,
    showDisclaimer: false,
    bestByDays: 7,
    netWeightUS: "",
    netWeight: "",
  } as unknown as LabelTemplate;
  const profile = {
    name: "", phone: "", address: "12 Elm St", registrationNumber: "",
  } as unknown as BusinessProfile;

  it("registration mode joins phone and registration number", () => {
    const l = {
      ...baseLabel, businessIdMode: "registration",
      phoneNumber: "555-1234", registrationNumber: "REG-9",
    } as unknown as LabelTemplate;
    expect(effectiveText(el("businessId"), l, profile)).toBe("555-1234 · REG-9");
  });
  it("address mode returns the address", () => {
    const l = { ...baseLabel, businessIdMode: "address" } as unknown as LabelTemplate;
    expect(effectiveText(el("businessId"), l, profile)).toBe("12 Elm St");
  });
  it("hides price when showPrice is false, shows when true", () => {
    const hidden = { ...baseLabel } as unknown as LabelTemplate;
    expect(effectiveText(el("price"), hidden, profile)).toBe("");
    const shown = { ...baseLabel, showPrice: true, price: "$3.00" } as unknown as LabelTemplate;
    expect(effectiveText(el("price"), shown, profile)).toBe("$3.00");
  });
  it("bestBy uses provided bestByStr", () => {
    const l = { ...baseLabel, showBestBy: true } as unknown as LabelTemplate;
    expect(effectiveText(el("bestBy"), l, profile, "Aug 31")).toBe("Best by Aug 31");
  });
  it("prefixes ingredients", () => {
    const l = { ...baseLabel, ingredients: "Flour, Sugar" } as unknown as LabelTemplate;
    expect(effectiveText(el("ingredients"), l, profile)).toBe("Ingredients: Flour, Sugar");
  });
  it("netWeight falls back to netWeight when US value empty", () => {
    const l = { ...baseLabel, netWeightUS: "", netWeight: "8 oz" } as unknown as LabelTemplate;
    expect(effectiveText(el("netWeight"), l, profile)).toBe("8 oz");
  });
});
