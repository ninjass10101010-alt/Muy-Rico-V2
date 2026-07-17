import { describe, it, expect } from "vitest";
import {
  detectAllergens,
  renderContainsLine,
  isPOBox,
  usToMetricUS,
  cqwToPt,
  ptToCqw,
  luminance,
  wcagContrast,
  validateLabel,
} from "./compliance";
import type { LabelTemplate, BusinessProfile } from "../types";

/* ── Helpers ─────────────────────────────────────────────────── */

function makeLabel(overrides: Partial<LabelTemplate> = {}): LabelTemplate {
  return {
    id: "test",
    name: "Test Label",
    shape: "rounded",
    bgColor: "#FFFFFF",
    accentColor: "#000000",
    textColor: "#000000",
    businessName: "Muy Rico",
    productName: "Chocolate Cookie",
    details: "Handmade in small batches",
    ingredients: "Flour, sugar, butter, cocoa, vanilla",
    allergens: "Contains: milk, wheat.",
    netWeight: "8 oz",
    netWeightUS: "8 oz",
    netWeightMetric: "226.8 g",
    price: "5.99",
    showPrice: false,
    showBestBy: false,
    bestByDays: 30,
    logoEmoji: "",
    font: "serif",
    businessIdMode: "address",
    address: "123 Main St, Ann Arbor, MI 48103",
    phoneNumber: "",
    registrationNumber: "",
    showDisclaimer: true,
    labelWidth: 3.5,
    labelHeight: 2,
    orientation: "landscape",
    websiteUrl: "",
    elements: [
      { id: "e1", type: "text", field: "disclaimer", x: 0, y: 0, w: 100, h: 10, z: 1, rotation: 0, hidden: false, fontSizeOverride: 4.37 },
    ],
    disclaimerVariant: "standard",
    productType: "standard",
    allergenTags: ["Milk", "Wheat"],
    noAllergensConfirmed: false,
    nutrientClaim: false,
    averyPreset: "single",
    ...overrides,
  };
}

const defaultProfile: BusinessProfile = {
  name: "Muy Rico",
  tagline: "",
  address: "456 Oak Ave, Detroit, MI 48201",
  phone: "555-0100",
  email: "hi@muy-rico.com",
  website: "",
  registrationNumber: "MSU-12345",
  businessType: "cottage",
  acceptedMethods: {
    stripe: true,
    cashapp: true,
    venmo: true,
    applepay: false,
    cash: true,
  },
  cashtag: "$muyrico",
  venmoHandle: "muy-rico",
  applePayEnabled: false,
  stripeConnected: true,
};

/* ── detectAllergens ─────────────────────────────────────────── */

describe("detectAllergens", () => {
  it("detects Milk", () => {
    expect(detectAllergens("contains milk")).toEqual(["Milk"]);
  });

  it("detects Eggs", () => {
    expect(detectAllergens("contains eggs")).toEqual(["Eggs"]);
  });

  it("detects Fish (word boundary)", () => {
    expect(detectAllergens("contains fish")).toEqual(["Fish"]);
  });

  it("does not detect 'shellfish' as Fish", () => {
    expect(detectAllergens("contains shellfish")).toEqual(["Crustacean Shellfish"]);
  });

  it("detects Crustacean Shellfish via sub-strings", () => {
    expect(detectAllergens("contains shrimp and crab")).toEqual(["Crustacean Shellfish"]);
  });

  it("detects Tree Nuts via sub-species", () => {
    expect(detectAllergens("contains almonds and pecans")).toEqual(["Tree Nuts"]);
  });

  it("detects Peanuts", () => {
    expect(detectAllergens("contains peanuts")).toEqual(["Peanuts"]);
  });

  it("detects Wheat", () => {
    expect(detectAllergens("contains wheat")).toEqual(["Wheat"]);
  });

  it("detects Soybeans", () => {
    expect(detectAllergens("contains soybeans")).toEqual(["Soybeans"]);
  });

  it("detects Sesame", () => {
    expect(detectAllergens("contains sesame")).toEqual(["Sesame"]);
  });

  it("returns multiple allergens", () => {
    const result = detectAllergens("contains milk, eggs, wheat, and almonds");
    expect(result).toContain("Milk");
    expect(result).toContain("Eggs");
    expect(result).toContain("Wheat");
    expect(result).toContain("Tree Nuts");
  });

  it("returns unique values (no dupes)", () => {
    const result = detectAllergens("contains milk and milk products");
    expect(result).toEqual(["Milk"]);
  });

  it("returns empty for no allergens", () => {
    expect(detectAllergens("sugar, flour, vanilla")).toEqual([]);
  });

  it("handles empty string", () => {
    expect(detectAllergens("")).toEqual([]);
  });

  it("case insensitive", () => {
    expect(detectAllergens("MILK")).toEqual(["Milk"]);
  });
});

/* ── renderContainsLine ──────────────────────────────────────── */

describe("renderContainsLine", () => {
  it("formats single allergen", () => {
    expect(renderContainsLine(["Milk"])).toBe("Contains: Milk.");
  });

  it("formats multiple allergens", () => {
    expect(renderContainsLine(["Milk", "Eggs"])).toBe("Contains: Milk, Eggs.");
  });

  it("expands Tree Nuts with sub-species", () => {
    const line = renderContainsLine(["Tree Nuts"]);
    expect(line).toMatch(/^Contains: Tree Nuts \(/);
    expect(line).toContain("Almonds");
    expect(line).toContain("Walnuts");
  });

  it("expands Crustacean Shellfish", () => {
    const line = renderContainsLine(["Crustacean Shellfish"]);
    expect(line).toMatch(/^Contains: Crustacean Shellfish \(/);
    expect(line).toContain("Shrimp");
  });

  it("returns empty for empty array", () => {
    expect(renderContainsLine([])).toBe("");
  });

  it("returns empty for null/undefined", () => {
    expect(renderContainsLine(null as unknown as string[])).toBe("");
  });
});

/* ── isPOBox ─────────────────────────────────────────────────── */

describe("isPOBox", () => {
  it("detects P.O. Box 123", () => {
    expect(isPOBox("P.O. Box 123")).toBe(true);
  });

  it("detects PO Box 456", () => {
    expect(isPOBox("PO Box 456")).toBe(true);
  });

  it("detects p.o. box 789 (lowercase)", () => {
    expect(isPOBox("p.o. box 789")).toBe(true);
  });

  it("detects Post Office Box 321", () => {
    expect(isPOBox("Post Office Box 321")).toBe(true);
  });

  it("detects PO BOX 111 (uppercase)", () => {
    expect(isPOBox("PO BOX 111")).toBe(true);
  });

  it("rejects street address", () => {
    expect(isPOBox("123 Main St, Ann Arbor, MI")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isPOBox("")).toBe(false);
  });

  it("rejects P.O. without number", () => {
    expect(isPOBox("P.O. Box")).toBe(false);
  });
});

/* ── usToMetricUS ────────────────────────────────────────────── */

describe("usToMetricUS", () => {
  it("converts oz to g", () => {
    expect(usToMetricUS("8 oz")).toBe("226.8 g");
  });

  it("converts fl oz to mL", () => {
    expect(usToMetricUS("12 fl oz")).toBe("355 mL");
  });

  it("converts floz to mL", () => {
    expect(usToMetricUS("8 floz")).toBe("237 mL");
  });

  it("converts lb to g", () => {
    expect(usToMetricUS("1 lb")).toBe("454 g");
  });

  it("converts lbs to g", () => {
    expect(usToMetricUS("1.5 lbs")).toBe("680 g");
  });

  it("returns empty for invalid input", () => {
    expect(usToMetricUS("")).toBe("");
  });

  it("returns empty for zero", () => {
    expect(usToMetricUS("0 oz")).toBe("");
  });

  it("returns empty for NaN", () => {
    expect(usToMetricUS("abc")).toBe("");
  });

  it("handles decimal oz", () => {
    expect(usToMetricUS("3.5 oz")).toBe("99.2 g");
  });
});

/* ── cqwToPt / ptToCqw ───────────────────────────────────────── */

describe("cqwToPt", () => {
  it("converts cqw to pt for 3.5in label", () => {
    // 4.37 cqw * 3.5 * 72 / 100 = 11.0124 pt
    const pt = cqwToPt(4.37, 3.5);
    expect(pt).toBeCloseTo(11.0, 0);
  });

  it("converts 0 cqw to 0 pt", () => {
    expect(cqwToPt(0, 3.5)).toBe(0);
  });
});

describe("ptToCqw", () => {
  it("converts pt to cqw for 3.5in label", () => {
    // 11 pt * 100 / (3.5 * 72) ≈ 4.365 cqw
    const cqw = ptToCqw(11, 3.5);
    expect(cqw).toBeCloseTo(4.365, 1);
  });

  it("round-trips cqw → pt → cqw", () => {
    const original = 4.37;
    const pt = cqwToPt(original, 3.5);
    const back = ptToCqw(pt, 3.5);
    expect(back).toBeCloseTo(original, 1);
  });
});

/* ── luminance ───────────────────────────────────────────────── */

describe("luminance", () => {
  it("returns 0 for black (#000000)", () => {
    expect(luminance("#000000")).toBeCloseTo(0, 4);
  });

  it("returns 1 for white (#FFFFFF)", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 4);
  });

  it("returns ~0.215 for #888888", () => {
    const l = luminance("#888888");
    expect(l).toBeGreaterThan(0.2);
    expect(l).toBeLessThan(0.3);
  });

  it("returns 0 for invalid hex", () => {
    expect(luminance("#FFF")).toBe(0);
  });
});

/* ── wcagContrast ────────────────────────────────────────────── */

describe("wcagContrast", () => {
  it("black on white = 21:1", () => {
    expect(wcagContrast("#000000", "#FFFFFF")).toBeCloseTo(21, 0);
  });

  it("white on black = 21:1", () => {
    expect(wcagContrast("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
  });

  it("same color = 1:1", () => {
    expect(wcagContrast("#FF0000", "#FF0000")).toBeCloseTo(1, 1);
  });

  it("#000000 on #888888 is above 4.5", () => {
    expect(wcagContrast("#000000", "#888888")).toBeGreaterThanOrEqual(4.5);
  });
});

/* ── validateLabel ───────────────────────────────────────────── */

describe("validateLabel", () => {
  it("returns compliant (score=100) for a valid label", () => {
    const result = validateLabel(makeLabel(), defaultProfile);
    expect(result.isCompliant).toBe(true);
    expect(result.score).toBe(100);
    expect(result.issues.length).toBe(0);
  });

  it("errors when business name is empty", () => {
    const result = validateLabel(
      makeLabel({ businessName: "" }),
      { ...defaultProfile, name: "" }
    );
    expect(result.isCompliant).toBe(false);
    expect(result.issues.some((i) => i.id === "biz-name")).toBe(true);
  });

  it("errors when product name is empty", () => {
    const result = validateLabel(makeLabel({ productName: "" }), defaultProfile);
    expect(result.issues.some((i) => i.id === "product-name")).toBe(true);
  });

  it("errors when ingredients are empty", () => {
    const result = validateLabel(makeLabel({ ingredients: "" }), defaultProfile);
    expect(result.issues.some((i) => i.id === "ingredients")).toBe(true);
  });

  it("errors when allergens not set and not confirmed", () => {
    const result = validateLabel(
      makeLabel({ allergenTags: [], noAllergensConfirmed: false }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "allergens")).toBe(true);
  });

  it("passes allergens check when noAllergensConfirmed", () => {
    const result = validateLabel(
      makeLabel({ allergenTags: [], noAllergensConfirmed: true }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "allergens")).toBe(false);
  });

  it("errors when net weight is missing", () => {
    const result = validateLabel(
      makeLabel({ netWeightUS: "", netWeight: "" }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "net-weight")).toBe(true);
  });

  it("uses label.netWeightUS as fallback for netWeight", () => {
    const result = validateLabel(
      makeLabel({ netWeightUS: "", netWeight: "3 oz" }),
      defaultProfile
    );
    // netWeightUS is falsy, falls back to netWeight which is truthy
    expect(result.issues.some((i) => i.id === "net-weight")).toBe(false);
  });

  it("errors when disclaimer is hidden", () => {
    const result = validateLabel(
      makeLabel({ showDisclaimer: false }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "disclaimer-hidden")).toBe(true);
  });

  it("errors when disclaimer font < 11pt", () => {
    const el = makeLabel().elements.find((e) => e.field === "disclaimer")!;
    el.fontSizeOverride = 1.5; // ~3.8pt
    const result = validateLabel(makeLabel({ elements: [el] }), defaultProfile);
    expect(result.issues.some((i) => i.id === "disclaimer-font")).toBe(true);
  });

  it("errors when disclaimer contrast < 4.5", () => {
    const result = validateLabel(
      makeLabel({ textColor: "#888888", bgColor: "#FFFFFF" }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "disclaimer-contrast")).toBe(true);
  });

  it("errors when NFP required but missing (nutrientClaim)", () => {
    const result = validateLabel(
      makeLabel({ nutrientClaim: true }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "nfp-missing")).toBe(true);
  });

  it("passes NFP check when NFP element present", () => {
    const result = validateLabel(
      makeLabel({
        nutrientClaim: true,
        elements: [
          ...makeLabel().elements,
          { id: "nfp1", type: "nfp", field: "nfp", x: 0, y: 0, w: 50, h: 80, z: 2, rotation: 0, hidden: false },
        ],
      }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "nfp-missing")).toBe(false);
  });

  it("adds wedding warning but score stays 100", () => {
    const result = validateLabel(
      makeLabel({ productType: "wedding" }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "wedding-note")).toBe(true);
    expect(result.score).toBe(100);
  });

  it("errors when address-mode label has PO Box address", () => {
    const result = validateLabel(
      makeLabel({
        businessIdMode: "address",
        address: "PO Box 123, Detroit, MI",
      }),
      defaultProfile
    );
    expect(result.issues.some((i) => i.id === "biz-pobox")).toBe(true);
  });

  it("errors when registration-mode has no phone", () => {
    const result = validateLabel(
      makeLabel({
        businessIdMode: "registration",
        phoneNumber: "",
        registrationNumber: "MSU-999",
      }),
      { ...defaultProfile, phone: "" }
    );
    expect(result.issues.some((i) => i.id === "biz-phone")).toBe(true);
  });

  it("errors when registration-mode has no reg number", () => {
    const result = validateLabel(
      makeLabel({
        businessIdMode: "registration",
        phoneNumber: "555-0100",
        registrationNumber: "",
      }),
      { ...defaultProfile, registrationNumber: "" }
    );
    expect(result.issues.some((i) => i.id === "biz-reg")).toBe(true);
  });

  it("score drops to 63 (3 errors out of 8)", () => {
    const result = validateLabel(
      makeLabel({
        businessName: "",
        productName: "",
        ingredients: "",
      }),
      { ...defaultProfile, name: "" }
    );
    // (1 - 3/8) * 100 = 62.5 → Math.round(62.5) = 63
    expect(result.score).toBe(63);
    expect(result.isCompliant).toBe(false);
  });

  it("score = 0 when all 8 checks fail", () => {
    const result = validateLabel(
      makeLabel({
        businessName: "",
        productName: "",
        ingredients: "",
        allergenTags: [],
        noAllergensConfirmed: false,
        netWeightUS: "",
        netWeight: "",
        showDisclaimer: false,
        nutrientClaim: true,
        elements: [],
        textColor: "#888888",
      }),
      defaultProfile
    );
    expect(result.score).toBe(0);
    expect(result.isCompliant).toBe(false);
  });
});
