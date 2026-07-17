import type { BusinessProfile, ComplianceIssue, ComplianceResult, LabelElement, LabelTemplate } from "../types";
import { disclaimerText } from "./disclaimer";
import { FDA_ALLERGENS_LIST, TREE_NUTS, SHELLFISH } from "./miLaw";
import { requiresNFP } from "./nfp";

/* ── FDA allergen taxonomy ───────────────────────────────────────────── */

export const FDA_ALLERGENS = FDA_ALLERGENS_LIST;
export const TREE_NUT_SUB = TREE_NUTS;
export const SHELLFISH_SUB = SHELLFISH;

export function detectAllergens(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const a of FDA_ALLERGENS) {
    const al = a.toLowerCase();
    if (al === "tree nuts") {
      const tnFound = TREE_NUTS.some((tn) => lower.includes(tn.toLowerCase()));
      if (tnFound) found.push("Tree Nuts");
    } else if (al === "fish") {
      if (/\bfish\b/.test(lower) && !lower.includes("shellfish")) found.push("Fish");
    } else if (al === "crustacean shellfish") {
      if (SHELLFISH.some((s) => lower.includes(s.toLowerCase())) ||
          lower.includes("shellfish")) found.push("Crustacean Shellfish");
    } else {
      const kw = a.toLowerCase();
      if (lower.includes(kw)) found.push(a);
    }
  }
  return [...new Set(found)];
}

export function renderContainsLine(allergens: string[]): string {
  if (!allergens || allergens.length === 0) return "";
  const names = allergens
    .map((a) => {
      if (a === "Tree Nuts") return `${a} (${TREE_NUTS.join(", ")})`;
      if (a === "Crustacean Shellfish") return `${a} (${SHELLFISH.join(", ")})`;
      return a;
    })
    .join(", ");
  return `Contains: ${names}.`;
}

/* ── P.O. Box detection ──────────────────────────────────────────────── */
export const PO_BOX_REGEX = /\b(p\.?o\.?\s*box|post\s*office\s*box)\s*\d+/i;

export function isPOBox(address: string): boolean {
  return PO_BOX_REGEX.test(address);
}

/* ── Net weight conversion ───────────────────────────────────────────── */
const OZ_TO_G = 28.3495;
const LB_TO_G = 453.592;
const FLOZ_TO_ML = 29.5735;

export function usToMetricUS(us: string): string {
  const parsed = parseFloat(us);
  if (isNaN(parsed) || parsed <= 0) return "";
  const lower = us.toLowerCase();
  if (lower.includes("oz") && !lower.includes("fl oz") && !lower.includes("floz")) {
    return `${(parsed * OZ_TO_G).toFixed(1)} g`;
  }
  if (lower.includes("fl oz") || lower.includes("floz")) {
    return `${(parsed * FLOZ_TO_ML).toFixed(0)} mL`;
  }
  if (lower.includes("lb") || lower.includes("lbs")) {
    return `${(parsed * LB_TO_G).toFixed(0)} g`;
  }
  return `${(parsed * OZ_TO_G).toFixed(1)} g`;
}

/* ── Font size helpers (cqw ↔ pt) ────────────────────────────────────── */
export function cqwToPt(cqw: number, labelWidthInches: number): number {
  return cqw * labelWidthInches * 72 / 100;
}

export function ptToCqw(pt: number, labelWidthInches: number): number {
  return pt * 100 / (labelWidthInches * 72);
}

/* ── WCAG contrast (simplified) ──────────────────────────────────────── */
function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return 0;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function wcagContrast(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/* ── Main validation engine ──────────────────────────────────────────── */
export function validateLabel(
  label: LabelTemplate,
  profile: BusinessProfile
): ComplianceResult {
  const issues: ComplianceIssue[] = [];

  /* 1 — Business identification */
  const bizName = label.businessName || profile.name;
  const address = label.address || profile.address;
  const phone = label.phoneNumber || profile.phone;
  const regNum = label.registrationNumber || profile.registrationNumber;
  const isReg = label.businessIdMode === "registration";

  const bizOk = isReg
    ? Boolean(phone && regNum)
    : Boolean(address && !isPOBox(address));
  if (!bizName) {
    issues.push({
      id: "biz-name",
      requirement: "Business name cannot be empty",
      severity: "error",
      fieldName: "businessName",
      current: bizName,
      fix: "Enter your business name",
    });
  }
  if (!isReg && !address) {
    issues.push({
      id: "biz-address",
      requirement: "Physical street address required (no P.O. Box)",
      severity: "error",
      fieldName: "address",
      current: address,
      fix: "Enter your street address",
    });
  } else if (!isReg && address && isPOBox(address)) {
    issues.push({
      id: "biz-pobox",
      requirement: "P.O. Box not allowed — enter a physical street address",
      severity: "error",
      fieldName: "address",
      current: address,
      fix: "Remove the P.O. Box and enter a physical address",
    });
  }
  if (isReg && !phone) {
    issues.push({
      id: "biz-phone",
      requirement: "Phone number required when using registration number",
      severity: "error",
      fieldName: "phoneNumber",
      current: phone,
      fix: "Enter your phone number",
    });
  }
  if (isReg && !regNum) {
    issues.push({
      id: "biz-reg",
      requirement: "MSU registration number required",
      severity: "error",
      fieldName: "registrationNumber",
      current: regNum,
      fix: "Enter your MSU Product Center registration number",
    });
  }

  /* 2 — Product name */
  if (!label.productName.trim()) {
    issues.push({
      id: "product-name",
      requirement: "Product name cannot be empty",
      severity: "error",
      fieldName: "productName",
      current: label.productName,
      fix: "Enter the product name",
    });
  }

  /* 3 — Ingredients */
  if (!label.ingredients.trim()) {
    issues.push({
      id: "ingredients",
      requirement: "Ingredients list cannot be empty",
      severity: "error",
      fieldName: "ingredients",
      current: label.ingredients,
      fix: "Add ingredients in descending order by weight",
    });
  }

  /* 4 — Allergens */
  const hasTags = label.allergenTags && label.allergenTags.length > 0;
  if (!hasTags && !label.noAllergensConfirmed) {
    issues.push({
      id: "allergens",
      requirement: "Allergen disclosure required — select allergens or confirm 'none'",
      severity: "error",
      fieldName: "allergens",
      current: label.allergens || "—",
      fix: "Select allergens from the picker or check 'No major allergens'",
    });
  }

  /* 5 — Net weight */
  const netUS = label.netWeightUS || label.netWeight;
  if (!netUS || parseFloat(netUS) <= 0) {
    issues.push({
      id: "net-weight",
      requirement: "Net weight required in US units (metric auto-converted)",
      severity: "error",
      fieldName: "netWeightUS",
      current: netUS,
      fix: "Enter the net weight (e.g. '3 oz')",
    });
  }

  /* 6 — Disclaimer */
  const disclaimerEl = label.elements.find((e) => e.field === "disclaimer");
  const disclaimerFont = disclaimerEl?.fontSizeOverride ?? 3.8;
  const disclaimerPt = cqwToPt(disclaimerFont, label.labelWidth);
  const fg = disclaimerEl?.colorOverride || label.textColor;
  const bg = label.bgColor;
  const contrast = wcagContrast(fg, bg);

  if (!label.showDisclaimer) {
    issues.push({
      id: "disclaimer-hidden",
      requirement: "Michigan disclaimer must be visible (cannot be hidden)",
      severity: "error",
      fieldName: "showDisclaimer",
      current: "Hidden",
      fix: "Enable the disclaimer in MDARD disclaimer settings",
    });
  }
  if (disclaimerPt < 11) {
    issues.push({
      id: "disclaimer-font",
      requirement: `Disclaimer must be at least 11pt (currently ${disclaimerPt.toFixed(1)}pt)`,
      severity: "error",
      fieldName: "",
      current: `${disclaimerPt.toFixed(1)}pt`,
      fix: "Increase the disclaimer font size",
      elementId: disclaimerEl?.id,
    });
  }
  if (contrast < 4.5) {
    issues.push({
      id: "disclaimer-contrast",
      requirement: `Disclaimer text must have sufficient contrast (ratio: ${contrast.toFixed(1)}:1, need ≥ 4.5:1)`,
      severity: "error",
      fieldName: "",
      current: `${contrast.toFixed(1)}:1`,
      fix: "Darken the text or lighten the background",
    });
  }

  /* 7 — Nutrient claim / NFP */
  const nfpNeeded = requiresNFP(label.nutrientClaim, label.productName, label.details);
  const hasNfp = label.elements.some((e) => e.type === "nfp");
  if (nfpNeeded && !hasNfp) {
    issues.push({
      id: "nfp-missing",
      requirement: "Nutrition Facts panel required (nutrient claim detected)",
      severity: "error",
      fieldName: "",
      current: "Missing",
      fix: "Add a Nutrition Facts panel element to the label",
    });
  }

  /* 8 — Product type (always passes, but wedding gets a note) */
  if (label.productType === "wedding") {
    issues.push({
      id: "wedding-note",
      requirement: "For wedding/specialty cakes: all label fields must appear on the invoice delivered with the cake",
      severity: "warning",
      fieldName: "productType",
      current: "Wedding/Specialty Cake",
    });
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const totalChecks = 8;
  const score = Math.max(0, Math.round((1 - errorCount / totalChecks) * 100));

  return {
    score,
    issues,
    isCompliant: score === 100,
  };
}
