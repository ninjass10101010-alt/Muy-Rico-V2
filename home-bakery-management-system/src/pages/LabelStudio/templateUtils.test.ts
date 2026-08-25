import { describe, expect, it } from "vitest";
import { makeFallback, normalizeLabel } from "./templateUtils";
import type { LabelTemplate } from "../../types";

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
