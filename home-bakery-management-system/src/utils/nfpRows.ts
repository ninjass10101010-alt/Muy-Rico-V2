import type { NfpData } from "../types";

export interface NfpRow {
  key: keyof NfpData;
  label: string;
  indent: 0 | 1;
  bold?: boolean;
  dvThreshold?: number; // % Daily Value denominator (2000-cal diet)
  group: "header" | "core" | "micro";
}

export const NFP_ROWS: NfpRow[] = [
  { key: "servingSize", label: "Serving Size", indent: 0, bold: true, group: "header" },
  { key: "servings", label: "Servings Per Container", indent: 0, bold: true, group: "header" },
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
