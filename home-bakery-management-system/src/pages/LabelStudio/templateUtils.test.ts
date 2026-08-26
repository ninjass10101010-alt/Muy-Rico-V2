import { describe, expect, it } from "vitest";
import { makeFallback, normalizeLabel, rescaleTemplateForDimensions } from "./templateUtils";
import { cqwToPt, ptToCqw } from "../../utils/compliance";
import type { LabelElement, LabelTemplate } from "../../types";

const STRING_FIELDS = [
  "shape",
  "bgColor",
  "accentColor",
  "textColor",
  "businessName",
  "productName",
  "details",
  "ingredients",
  "allergens",
  "netWeight",
  "price",
  "logoEmoji",
  "font",
  "businessIdMode",
  "address",
  "phoneNumber",
  "registrationNumber",
  "orientation",
  "websiteUrl",
] as const;

function expectCompleteDoc(doc: LabelTemplate) {
  for (const field of STRING_FIELDS) {
    const value = doc[field];
    expect(value, `field "${field}" must be defined`).toBeDefined();
    expect(typeof value === "string" ? value.trim() : value).toBeDefined();
  }
  expect(Array.isArray(doc.elements)).toBe(true);
  expect(doc.showDisclaimer).toBeDefined();
  expect(doc.disclaimerVariant).toBeDefined();
  expect(doc.productType).toBeDefined();
  expect(Array.isArray(doc.allergenTags)).toBe(true);
  expect(doc.averyPreset).toBeDefined();
}

describe("normalizeLabel totality", () => {
  it("fills every renderer/compliance field for a bare legacy template", () => {
    const doc = normalizeLabel({ id: "x", name: "MR-9" } as never, "");
    expectCompleteDoc(doc);
    expect(doc.templateKind).toBe("order");
    expect(doc.productId).toBeNull();
  });

  it("preserves provided values", () => {
    const doc = normalizeLabel(
      { id: "x", name: "MR-9", productName: "Conchas", templateKind: "product" } as never,
      ""
    );
    expect(doc.productName).toBe("Conchas");
    expect(doc.templateKind).toBe("product");
  });
});

describe("makeFallback totality", () => {
  it("produces a complete document", () => {
    const doc = makeFallback("");
    expectCompleteDoc(doc);
  });
});

const fakeMeasure = (line: string, _f: string, px: number) => line.length * px * 0.5;

function docWith(over: Partial<LabelTemplate>, els: Partial<LabelElement>[]): LabelTemplate {
  const base = makeFallback("");
  return {
    ...base,
    ...over,
    elements: els.map((e, i) => ({
      id: `el${i}`, type: "text", x: 0.05, y: 0.1, w: 0.9, h: 0.08, z: 5,
      fontSizeOverride: 4, ...e,
    })) as LabelElement[],
  };
}

describe("rescaleTemplateForDimensions", () => {
  it("keeps physical pt size when width changes (pt-parity)", () => {
    const disclaimerCqw = ptToCqw(11, 3); // 11pt on a 3in-wide label
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ field: "disclaimer", fontSizeOverride: disclaimerCqw }]
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 2, labelHeight: 4, shape: "rounded", orientation: "portrait" }, fakeMeasure
    );
    const el = next.elements.find((e) => e.field === "disclaimer")!;
    expect(cqwToPt(el.fontSizeOverride!, 2)).toBeCloseTo(11, 5);
  });

  it("converts logoSize with the same parity", () => {
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait", logoSize: 16 },
      []
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 1.5, labelHeight: 4, shape: "rounded", orientation: "portrait" }, fakeMeasure
    );
    expect(cqwToPt(next.logoSize!, 1.5)).toBeCloseTo(cqwToPt(16, 3), 5);
  });

  it("auto-grows a text box whose wrapped text exceeds its height, clamped at label bottom", () => {
    // 40-char word at 4cqw on 3in → px = 0.04*288 = 11.52; width px = 0.9*288 = 259.2
    // fakeMeasure: 40 chars * 11.52 * 0.5 = 230.4 < 259.2 → 1 line. Use a long word list instead:
    const longText = "word ".repeat(30).trim(); // wraps to multiple lines
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ y: 0.5, h: 0.05, text: longText, fontSizeOverride: 4 }]
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" }, fakeMeasure
    );
    const el = next.elements[0];
    const px = (4 / 100) * 3 * 96;
    const lines = Math.ceil((longText.length * px * 0.5) / (0.9 * 3 * 96));
    const needed = Math.min((lines * px * 1.2) / (4 * 96), 1 - 0.5);
    expect(el.h).toBeCloseTo(needed, 5);
    expect(el.h).toBeGreaterThan(0.05);
  });

  it("is a no-op when effective dimensions are unchanged", () => {
    const prev = docWith({ labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ fontSizeOverride: 7, h: 0.2, text: "hello world" }]);
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" }, fakeMeasure
    );
    expect(next.elements).toEqual(prev.elements);
    expect(next.labelWidth).toBe(3);
  });

  it("handles orientation swap (3x4 portrait → 4x3 landscape)", () => {
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ fontSizeOverride: ptToCqw(11, 3) }]
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "landscape" }, fakeMeasure
    );
    expect(cqwToPt(next.elements[0].fontSizeOverride!, 4)).toBeCloseTo(11, 5);
  });

  it("square-ification: circle shape collapses to min dimension for parity math", () => {
    const prev = docWith(
      { labelWidth: 3, labelHeight: 4, shape: "rounded", orientation: "portrait" },
      [{ fontSizeOverride: ptToCqw(11, 3) }]
    );
    const next = rescaleTemplateForDimensions(
      prev, { labelWidth: 3, labelHeight: 4, shape: "circle", orientation: "portrait" }, fakeMeasure
    );
    expect(cqwToPt(next.elements[0].fontSizeOverride!, 3)).toBeCloseTo(11, 5); // effW stays 3 (min)
  });
});
