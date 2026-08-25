import type { LabelElement, LabelTemplate } from "../../types";
import { defaultElementsFor } from "../../components/label/defaultElements";

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
