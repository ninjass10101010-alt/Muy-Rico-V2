import type { BusinessProfile, LabelElement, LabelTemplate, NfpData } from "../../types";
import { disclaimerText } from "../../utils/disclaimer";

export interface Rect { x: number; y: number; w: number; h: number }

export function resolveBestBy(label: LabelTemplate, now: Date = new Date()): Date {
  if (label.bestByDate) {
    const d = new Date(label.bestByDate);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(now.getTime() + (label.bestByDays || 7) * 86400000);
}

export function formatBestBy(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function effectiveText(
  el: LabelElement,
  label: LabelTemplate,
  profile: BusinessProfile,
  bestByStr?: string
): string {
  const effName = label.businessName || profile.name || "";
  const effPhone = label.phoneNumber || profile.phone || "";
  const effReg = label.registrationNumber || profile.registrationNumber || "";
  const effAddr = label.address || profile.address || "";
  const isReg = label.businessIdMode === "registration";
  switch (el.field) {
    case "businessName": return effName;
    case "businessId":
      return isReg ? `${effPhone} · ${effReg}` : effAddr;
    case "productName": return label.productName || "";
    case "details": return label.details || "";
    case "ingredients": return label.ingredients ? `Ingredients: ${label.ingredients}` : "";
    case "allergens": return label.allergens || "";
    case "netWeight": return label.netWeightUS || label.netWeight || "";
    case "price": return label.showPrice ? label.price || "" : "";
    case "bestBy":
      return label.showBestBy ? `Best by ${bestByStr ?? formatBestBy(resolveBestBy(label))}` : "";
    case "disclaimer": return label.showDisclaimer ? disclaimerText() : "";
    default: return el.type === "text" ? el.text || "" : "";
  }
}

/** Greedy word wrap. `measure(line)` returns rendered width; caller supplies metrics. */
export function wrapLines(
  text: string,
  measure: (line: string) => number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measure(candidate) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Snap `moving` rect against sibling rects + canvas edges/center.
 * Returns pixel deltas to apply and guide positions (normalized) that fired.
 */
export function computeSnap(
  moving: Rect,
  others: Rect[],
  threshold: number
): { dx: number; dy: number; guidesX: number[]; guidesY: number[] } {
  const xs: number[] = [0, 0.5, 1];
  const ys: number[] = [0, 0.5, 1];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const mLeft = moving.x, mCenterX = moving.x + moving.w / 2, mRight = moving.x + moving.w;
  const mTop = moving.y, mCenterY = moving.y + moving.h / 2, mBottom = moving.y + moving.h;

  let dx = 0, dy = 0;
  const guidesX: number[] = [], guidesY: number[] = [];
  let bestDx = threshold, bestDy = threshold;

  for (const t of xs) {
    for (const mEdge of [mLeft, mCenterX, mRight]) {
      const delta = t - mEdge;
      if (Math.abs(delta) < bestDx) { bestDx = Math.abs(delta); dx = delta; guidesX.length = 0; guidesX.push(t); }
    }
  }
  for (const t of ys) {
    for (const mEdge of [mTop, mCenterY, mBottom]) {
      const delta = t - mEdge;
      if (Math.abs(delta) < bestDy) { bestDy = Math.abs(delta); dy = delta; guidesY.length = 0; guidesY.push(t); }
    }
  }
  if (guidesX.length === 0) dx = 0;
  if (guidesY.length === 0) dy = 0;
  return { dx, dy, guidesX, guidesY };
}

export interface NfpRow {
  key: keyof NfpData;
  label: string;
  indent: 0 | 1;
  bold?: boolean;
  dvThreshold?: number; // % Daily Value denominator (2000-cal diet)
  group: "header" | "core" | "micro";
}

export const NFP_ROWS: NfpRow[] = [
  { key: "servingSize", label: "Serving size", indent: 0, bold: true, group: "header" },
  { key: "servings", label: "Servings", indent: 0, group: "header" },
  { key: "calories", label: "Calories", indent: 0, bold: true, group: "core" },
  { key: "totalFat", label: "Total Fat", indent: 0, bold: true, dvThreshold: 78, group: "core" },
  { key: "satFat", label: "Saturated Fat", indent: 1, dvThreshold: 20, group: "core" },
  { key: "transFat", label: "Trans Fat", indent: 1, group: "core" },
  { key: "cholesterol", label: "Cholesterol", indent: 0, dvThreshold: 300, group: "core" },
  { key: "sodium", label: "Sodium", indent: 0, dvThreshold: 2300, group: "core" },
  { key: "totalCarb", label: "Total Carbohydrate", indent: 0, bold: true, dvThreshold: 275, group: "core" },
  { key: "fiber", label: "Dietary Fiber", indent: 1, dvThreshold: 28, group: "core" },
  { key: "sugars", label: "Total Sugars", indent: 1, group: "core" },
  { key: "addedSugars", label: "Includes Added Sugars", indent: 1, dvThreshold: 50, group: "core" },
  { key: "protein", label: "Protein", indent: 0, bold: true, group: "core" },
  { key: "vitD", label: "Vitamin D", indent: 0, dvThreshold: 20, group: "micro" },
  { key: "calcium", label: "Calcium", indent: 0, dvThreshold: 1300, group: "micro" },
  { key: "iron", label: "Iron", indent: 0, dvThreshold: 18, group: "micro" },
  { key: "potassium", label: "Potassium", indent: 0, dvThreshold: 4700, group: "micro" },
  { key: "vitA", label: "Vitamin A", indent: 0, group: "micro" },
  { key: "vitC", label: "Vitamin C", indent: 0, group: "micro" },
];

export function dvPercent(raw: string, threshold?: number): string {
  const v = parseFloat(raw);
  if (!threshold || isNaN(v) || v <= 0) return "";
  return `${Math.round((v / threshold) * 100)}%`;
}
