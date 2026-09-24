import { describe, expect, it } from "vitest";
import { distinctInventoryValues, filterAndSortInventory } from "./inventoryTable";
import type { InventoryItem } from "../types";

const mkItem = (partial: Partial<InventoryItem>): InventoryItem => ({
  id: "inv-1",
  name: "Flour",
  category: "Dry Goods",
  quantity: 10,
  unit: "lb",
  reorderLevel: 5,
  costPerUnit: 1,
  supplier: "",
  active: true,
  ...partial,
});

const items: InventoryItem[] = [
  mkItem({ id: "1", name: "Flour", category: "Dry Goods", quantity: 2, reorderLevel: 5, costPerUnit: 1 }),
  mkItem({ id: "2", name: "Butter", category: "Dairy", quantity: 0, reorderLevel: 3, costPerUnit: 4 }),
  mkItem({ id: "3", name: "Vanilla", category: "Flavors", quantity: 9, reorderLevel: 2, costPerUnit: 12 }),
];

describe("filterAndSortInventory", () => {
  it("returns all items for an empty query", () => {
    expect(filterAndSortInventory(items, {})).toHaveLength(3);
  });

  it("filters by name search case-insensitively", () => {
    expect(filterAndSortInventory(items, { search: "FLOUR" }).map((i) => i.id)).toEqual(["1"]);
  });

  it("treats quantity at or below reorder level as low", () => {
    expect(filterAndSortInventory(items, { status: "low" }).map((i) => i.id)).toEqual(["1", "2"]);
  });

  it("treats quantity at or below zero as out", () => {
    expect(filterAndSortInventory(items, { status: "out" }).map((i) => i.id)).toEqual(["2"]);
  });

  it("combines search, status and category", () => {
    const result = filterAndSortInventory(items, { search: "", status: "low", category: "Dairy" });
    expect(result.map((i) => i.id)).toEqual(["2"]);
  });

  it("sorts by name ascending and descending", () => {
    expect(filterAndSortInventory(items, { sortKey: "name", sortDir: "asc" }).map((i) => i.name)).toEqual([
      "Butter",
      "Flour",
      "Vanilla",
    ]);
    expect(filterAndSortInventory(items, { sortKey: "name", sortDir: "desc" }).map((i) => i.name)).toEqual([
      "Vanilla",
      "Flour",
      "Butter",
    ]);
  });

  it("sorts numerically by quantity and cost", () => {
    expect(filterAndSortInventory(items, { sortKey: "quantity" })[0].id).toBe("2");
    expect(filterAndSortInventory(items, { sortKey: "quantity", sortDir: "desc" })[0].id).toBe("3");
    expect(filterAndSortInventory(items, { sortKey: "costPerUnit" })[0].id).toBe("1");
  });

  it("sorts by reorder level", () => {
    expect(filterAndSortInventory(items, { sortKey: "reorderLevel" }).map((i) => i.id)).toEqual(["3", "2", "1"]);
  });

  it("does not mutate the input array", () => {
    const snapshot = [...items];
    filterAndSortInventory(items, { sortKey: "name" });
    expect(items).toEqual(snapshot);
  });
});

describe("distinctInventoryValues", () => {
  it("returns sorted distinct categories without blanks", () => {
    const input = [
      mkItem({ category: "Dairy" }),
      mkItem({ category: "Dry Goods" }),
      mkItem({ category: "Dairy" }),
      mkItem({ category: "  " }),
    ];
    expect(distinctInventoryValues(input, "category")).toEqual(["Dairy", "Dry Goods"]);
  });

  it("returns sorted distinct units", () => {
    const input = [mkItem({ unit: "lb" }), mkItem({ unit: "each" }), mkItem({ unit: "lb" })];
    expect(distinctInventoryValues(input, "unit")).toEqual(["each", "lb"]);
  });
});
