import { describe, it, expect } from "vitest";
import {
  createLruCache,
  normalizeAllergenTags,
  parseQuantityToLb,
  mapOffProduct,
  usdaCandidatesFromResponse,
  categoryAllergenHints,
} from "../workers/enrich-lib.js";

describe("normalizeAllergenTags", () => {
  it("maps known en: tags to canonical labels and drops unknown ones", () => {
    expect(normalizeAllergenTags(["en:milk", "en:wheat", "en:soybeans", "en:some-unknown"])).toEqual([
      "Milk",
      "Wheat",
      "Soy",
    ]);
  });
  it("dedupes and returns [] for empty input", () => {
    expect(normalizeAllergenTags(["en:milk", "en:milk", "en:soybeans"])).toEqual(["Milk", "Soy"]);
    expect(normalizeAllergenTags([])).toEqual([]);
  });
});

describe("parseQuantityToLb", () => {
  it("converts g, kg, oz, lb", () => {
    expect(parseQuantityToLb(500, "g")).toBeCloseTo(500 / 453.59237, 6);
    expect(parseQuantityToLb(2, "kg")).toBeCloseTo(2000 / 453.59237, 6);
    expect(parseQuantityToLb(16, "oz")).toBeCloseTo(1, 6);
    expect(parseQuantityToLb(1, "lb")).toBeCloseTo(1, 6);
  });
  it("returns null for unsupported units, non-positive, or invalid values", () => {
    expect(parseQuantityToLb(500, "ml")).toBeNull();
    expect(parseQuantityToLb(0, "g")).toBeNull();
    expect(parseQuantityToLb(NaN, "g")).toBeNull();
    expect(parseQuantityToLb(5, "")).toBeNull();
  });
});

describe("mapOffProduct", () => {
  it("maps a full product with quantity_value/quantity_unit", () => {
    const out = mapOffProduct({
      product_name: "100% Whole Wheat Flour",
      product_name_en: "100% Whole Wheat Flour",
      brands: "King Arthur, Other",
      ingredients_text_en: "whole wheat flour",
      ingredients_text: "farine de blé entier",
      allergens_tags: ["en:milk", "en:wheat"],
      quantity_value: 500,
      quantity_unit: "g",
      quantity: "500 g",
      image_front_url: "https://images.openfoodfacts.org/1.jpg",
    });
    expect(out).toEqual({
      name: "100% Whole Wheat Flour",
      brand: "King Arthur",
      ingredients: "whole wheat flour",
      allergens: ["Milk", "Wheat"],
      quantity: "500 g",
      unitWeightLb: 500 / 453.59237,
      imageUrl: "https://images.openfoodfacts.org/1.jpg",
    });
  });
  it("falls back to parsing the quantity string when value/unit are absent", () => {
    const out = mapOffProduct({ product_name: "Butter", quantity: "16 oz" });
    expect(out.unitWeightLb).toBeCloseTo(1, 6);
  });
  it("returns null when there is no product name or the input is null", () => {
    expect(mapOffProduct({ brands: "X" })).toBeNull();
    expect(mapOffProduct(null)).toBeNull();
  });
});

describe("usdaCandidatesFromResponse", () => {
  const sample = {
    foods: [
      {
        fdcId: 2490378,
        description: "Wheat flour, white, all-purpose",
        dataType: "Foundation",
        foodCategory: "Cereal Grains and Pasta",
        ingredients: null,
        foodPortions: [{ portionDescription: "cup", gramWeight: 125 }],
        foodNutrients: [
          { nutrientName: "Energy", value: 364 },
          { nutrientName: "Protein", value: 10.33 },
          { nutrientName: "Carbohydrate, by difference", value: 76.31 },
          { nutrientName: "Total lipid (fat)", value: 0.98 },
        ],
      },
      { fdcId: 2, description: "Branded flour", dataType: "Branded", foodCategory: null, foodPortions: [], foodNutrients: [] },
    ],
  };
  it("drops Branded items and maps candidate fields", () => {
    const out = usdaCandidatesFromResponse(sample);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      fdcId: 2490378,
      name: "Wheat flour, white, all-purpose",
      dataType: "Foundation",
      foodCategory: "Cereal Grains and Pasta",
      portionGramWeight: 125,
      allergenHints: ["Wheat"],
      per100g: { energy: 364, protein: 10.33, carbs: 76.31, fat: 0.98 },
    });
  });
  it("returns [] for a malformed response", () => {
    expect(usdaCandidatesFromResponse({})).toEqual([]);
    expect(usdaCandidatesFromResponse(null)).toEqual([]);
  });
});

describe("categoryAllergenHints", () => {
  it("maps obvious categories only", () => {
    expect(categoryAllergenHints("Cereal Grains and Pasta")).toEqual(["Wheat"]);
    expect(categoryAllergenHints("Milk and Milk Products")).toEqual(["Milk"]);
    expect(categoryAllergenHints("Legumes and Legume Products")).toEqual([]);
    expect(categoryAllergenHints(null)).toEqual([]);
  });
});

describe("createLruCache", () => {
  it("stores and returns values, refreshing recency on get", () => {
    const c = createLruCache(2, 60000);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // evicts "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    c.get("b");
    c.set("d", 4); // evicts "c", "b" survives
    expect(c.get("c")).toBeUndefined();
    expect(c.get("b")).toBe(2);
  });
  it("expires entries after ttlMs", async () => {
    const c = createLruCache(10, 20);
    c.set("a", 1);
    await new Promise((r) => setTimeout(r, 40));
    expect(c.get("a")).toBeUndefined();
  });
});
