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

export function defaultNfpData() {
  return {
    servingSize: "1 piece",
    servings: "1",
    calories: "0",
    totalFat: "0",
    satFat: "0",
    transFat: "0",
    cholesterol: "0",
    sodium: "0",
    totalCarb: "0",
    fiber: "0",
    sugars: "0",
    addedSugars: "0",
    protein: "0",
    vitD: "0",
    calcium: "0",
    iron: "0",
    potassium: "0",
    vitA: "0",
    vitC: "0",
  };
}
