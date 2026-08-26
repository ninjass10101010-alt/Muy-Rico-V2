import type { LabelElement, LabelTemplate, LabelOrientation, LabelShape } from "../../types";
import {
  defaultElementsFor,
  effectiveDimensions,
} from "../../components/label/defaultElements";
import { cqwToPt, ptToCqw } from "../../utils/compliance";
import { wrapLines } from "./labelMath";

export function normalizeLabel(t: LabelTemplate, profileWebsite: string): LabelTemplate {
  const legacyOrder = /^MR-\d+|^Order #\d+/.test(t.name);
  return {
    ...t,
    shape: t.shape ?? "rounded",
    bgColor: t.bgColor ?? "#FBF3E7",
    accentColor: t.accentColor ?? "#C17A3F",
    textColor: t.textColor ?? "#4A3222",
    businessName: t.businessName ?? "",
    productName: t.productName ?? "",
    details: t.details ?? "",
    ingredients: t.ingredients ?? "",
    allergens: t.allergens ?? "",
    netWeight: t.netWeight ?? "",
    price: t.price ?? "",
    logoEmoji: t.logoEmoji ?? "🧁",
    font: t.font ?? "'Cormorant Garamond', Georgia, serif",
    businessIdMode: t.businessIdMode ?? "address",
    address: t.address ?? "",
    phoneNumber: t.phoneNumber ?? "",
    registrationNumber: t.registrationNumber ?? "",
    labelWidth: t.labelWidth ?? 3,
    labelHeight: t.labelHeight ?? 4,
    bestByDays: t.bestByDays ?? 7,
    showPrice: t.showPrice ?? false,
    showBestBy: t.showBestBy ?? false,
    orientation: t.orientation || "portrait",
    websiteUrl: t.websiteUrl || profileWebsite || "https://muy-rico.com",
    elements: t.elements && t.elements.length > 0 ? t.elements : defaultElementsFor(t),
    showDisclaimer: t.showDisclaimer !== false,
    disclaimerVariant: "standard",
    productType: t.productType === "wedding" ? "wedding" : "standard",
    allergenTags: t.allergenTags || [],
    noAllergensConfirmed: Boolean(t.noAllergensConfirmed),
    nutrientClaim: Boolean(t.nutrientClaim),
    averyPreset: t.averyPreset || "single",
    netWeightUS: t.netWeightUS || "",
    netWeightMetric: t.netWeightMetric || "",
    templateKind: t.templateKind || (legacyOrder ? "order" : "custom"),
    productId: t.productId ?? null,
  };
}

export function makeFallback(profileWebsite: string): LabelTemplate {
  const base: LabelTemplate = {
    id: "new",
    name: "New Label",
    shape: "rounded",
    bgColor: "#FBF3E7",
    accentColor: "#C17A3F",
    textColor: "#4A3222",
    businessName: "",
    productName: "",
    details: "",
    ingredients: "",
    allergens: "",
    netWeight: "",
    netWeightUS: "",
    netWeightMetric: "",
    price: "",
    showPrice: false,
    showBestBy: false,
    bestByDays: 7,
    logoEmoji: "🧁",
    font: "'Cormorant Garamond', Georgia, serif",
    businessIdMode: "address",
    address: "",
    phoneNumber: "",
    registrationNumber: "",
    showDisclaimer: true,
    labelWidth: 3,
    labelHeight: 4,
    orientation: "portrait",
    websiteUrl: profileWebsite || "https://muy-rico.com",
    elements: [],
    disclaimerVariant: "standard",
    productType: "standard",
    allergenTags: [],
    noAllergensConfirmed: false,
    nutrientClaim: false,
    averyPreset: "single",
  };
  return { ...base, elements: defaultElementsFor(base) };
}

/** Scale/clamp elements so they fit inside 0..1 after a shape/aspect change. Only scales on overflow. */
export function fitElementsToAspect(elements: LabelElement[]): LabelElement[] {
  let maxRight = 0;
  let maxBottom = 0;
  for (const el of elements) {
    maxRight = Math.max(maxRight, el.x + el.w);
    maxBottom = Math.max(maxBottom, el.y + el.h);
  }
  if (maxRight <= 1 && maxBottom <= 1) return elements;
  const scale = Math.min(1 / Math.max(maxRight, 0.001), 1 / Math.max(maxBottom, 0.001), 1);
  return elements.map((el) => {
    const w = Math.min(el.w * scale, 1);
    const h = Math.min(el.h * scale, 1);
    const x = Math.min(Math.max(el.x * scale, 0), 1 - w);
    const y = Math.min(Math.max(el.y * scale, 0), 1 - h);
    return { ...el, x, y, w, h };
  });
}

export interface TemplateDims {
  labelWidth: number;
  labelHeight: number;
  shape: LabelShape;
  orientation: LabelOrientation;
}

export type TextMeasure = (line: string, fontFamily: string, px: number, bold: boolean) => number;

let cachedCtx: CanvasRenderingContext2D | null | undefined;
function defaultMeasure(line: string, fontFamily: string, px: number, bold: boolean): number {
  if (cachedCtx === undefined) {
    try {
      cachedCtx = document.createElement("canvas").getContext("2d");
    } catch {
      cachedCtx = null;
    }
  }
  if (!cachedCtx) return line.length * px * 0.5;
  cachedCtx.font = `${bold ? 700 : 400} ${px}px ${fontFamily}`;
  return cachedCtx.measureText(line).width;
}

const PX_PER_IN = 96;

/**
 * Re-fit a template for a new dimension set: fonts keep their PHYSICAL size
 * (pt-parity), boxes keep relative positions, text boxes auto-grow to fit
 * their re-wrapped content (clamped at the label bottom). Pure; one store
 * commit per user action happens at the call site.
 */
export function rescaleTemplateForDimensions(
  prev: LabelTemplate,
  next: TemplateDims,
  measure: TextMeasure = defaultMeasure
): LabelTemplate {
  const prevEff = effectiveDimensions(
    prev.labelWidth, prev.labelHeight, prev.shape, prev.orientation || "portrait"
  );
  const nextEff = effectiveDimensions(
    next.labelWidth, next.labelHeight, next.shape, next.orientation
  );

  let elements = fitElementsToAspect(prev.elements || []);

  if (Math.abs(prevEff.effW - nextEff.effW) > 1e-9) {
    elements = elements.map((el) => {
      if (el.type === "text" && el.fontSizeOverride != null) {
        const pt = cqwToPt(el.fontSizeOverride, prevEff.effW);
        // No rounding here: pt-parity must survive round-trips exactly
        // (normative tests assert parity to 5 decimal places).
        return { ...el, fontSizeOverride: ptToCqw(pt, nextEff.effW) };
      }
      return el;
    });
  }

  // Auto-grow text boxes whose re-wrapped content exceeds their height.
  const nextWpx = nextEff.effW * PX_PER_IN;
  const nextHpx = nextEff.effH * PX_PER_IN;
  elements = elements.map((el) => {
    if (el.type !== "text" || el.hidden) return el;
    const text = el.text ?? "";
    if (!text.trim()) return el;
    const family = firstFamilyOf(el.fontFamilyOverride || prev.font);
    const px = ((el.fontSizeOverride ?? 4) / 100) * nextWpx;
    const lines = wrapLines(
      text,
      (s) => measure(s, family, px, Boolean(el.bold)),
      Math.max(1, el.w * nextWpx)
    );
    const neededNorm = (lines.length * px * 1.2) / nextHpx;
    if (neededNorm > el.h) {
      return { ...el, h: Math.min(neededNorm, Math.max(0.01, 1 - el.y)) };
    }
    return el;
  });

  const widthChanged = Math.abs(prevEff.effW - nextEff.effW) > 1e-9;
  const logoSize =
    widthChanged && prev.logoSize != null
      ? Math.round(ptToCqw(cqwToPt(prev.logoSize, prevEff.effW), nextEff.effW) * 100) / 100
      : prev.logoSize;

  return { ...prev, ...next, elements, logoSize };
}

// NOTE: intentionally mirrors firstFamily in capture.ts — do NOT import from
// capture.ts (keeps templateUtils DOM-light and test-friendly); duplication is
// two lines and acceptable here (DRY exception documented in the plan).
function firstFamilyOf(stack: string): string {
  const m = stack.match(/'([^']+)'|"([^"]+)"/);
  return (m?.[1] || m?.[2] || stack.split(",")[0] || "sans-serif").trim();
}
