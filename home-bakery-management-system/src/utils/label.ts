import type { InventoryItem, Product } from "../types";

interface ComposedLabel {
  ingredients: string;
  allergens: string;
}

// FDA "major food allergens" (per FALCPA + FDA 2024 sesame): keep sorted.
// Used to canonicalize tag input and provide a stable ordering for the
// "Contains: …" callout on the label.
const MAJOR_ALLERGEN_TAGS = [
  "Milk",
  "Eggs",
  "Fish",
  "Crustacean",
  "Tree Nuts",
  "Peanuts",
  "Wheat",
  "Soybeans",
  "Sesame",
];

function canonicalizeTag(raw: string): string {
  const target = String(raw).trim().toLowerCase();
  for (const canonical of MAJOR_ALLERGEN_TAGS) {
    if (canonical.toLowerCase() === target) return canonical;
  }
  // Common synonyms / variants
  if (target === "soy") return "Soybeans";
  if (target === "egg") return "Eggs";
  if (target === "tree nut") return "Tree Nuts";
  if (target === "peanut") return "Peanuts";
  if (target === "shellfish") return "Crustacean";
  // Unknown — preserve original casing
  return String(raw).trim();
}

export function composeLabelFromRecipe(
  product: Product,
  inventory: InventoryItem[]
): ComposedLabel {
  const lines = (product.recipe || [])
    .map((line) => {
      const item = inventory.find((i) => i.id === line.inventoryItemId);
      if (!item) return null;
      if (!item.ingredients_label) return null;
      const unitWeight =
        typeof item.unit_weight === "number" && item.unit_weight > 0
          ? item.unit_weight
          : 1;
      const weight = line.qtyPerUnit * unitWeight;
      return { item, weight };
    })
    .filter((x): x is { item: InventoryItem; weight: number } => x !== null);

  // Sort descending by weight (ties broken by item name for stability)
  lines.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.item.name.localeCompare(b.item.name);
  });

  const ingredients = lines.map((l) => l.item.ingredients_label).join(", ");

  // Allergen callout: union of all recipe lines' tags, sorted in FDA order
  const tagSet = new Set<string>();
  for (const l of lines) {
    for (const tag of l.item.allergens || []) {
      tagSet.add(canonicalizeTag(tag));
    }
  }

  const orderedAllergens = [...tagSet].sort((a, b) => {
    const aIdx = MAJOR_ALLERGEN_TAGS.indexOf(a);
    const bIdx = MAJOR_ALLERGEN_TAGS.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.localeCompare(b);
  });

  const allergens = orderedAllergens.length
    ? `Contains: ${orderedAllergens.map((a) => a.toLowerCase()).join(", ")}.`
    : "";

  return { ingredients, allergens };
}
