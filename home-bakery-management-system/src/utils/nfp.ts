import type { NfpData } from "../types";

export const NUTRIENT_CLAIM_KEYWORDS = [
  "low fat",
  "fat free",
  "sugar free",
  "low calorie",
  "calorie free",
  "high protein",
  "reduced",
  "light",
  "lean",
  "healthy",
  "low sodium",
  "no added sugar",
  "diet",
  "low carb",
  "zero sugar",
];

export function requiresNFP(
  nutrientClaim: boolean,
  productName: string,
  details: string
): boolean {
  if (nutrientClaim) return true;
  const search = `${productName} ${details}`.toLowerCase();
  return NUTRIENT_CLAIM_KEYWORDS.some((k) => search.includes(k));
}

export function defaultNfpData(): NfpData {
  return {
    servingSize: "",
    servings: "",
    calories: "",
    totalFat: "",
    satFat: "",
    transFat: "",
    cholesterol: "",
    sodium: "",
    totalCarb: "",
    fiber: "",
    sugars: "",
    addedSugars: "",
    protein: "",
    vitD: "",
    calcium: "",
    iron: "",
    potassium: "",
    vitA: "",
    vitC: "",
  };
}
