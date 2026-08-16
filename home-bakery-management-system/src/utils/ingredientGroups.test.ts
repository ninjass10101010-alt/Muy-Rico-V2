import { describe, it, expect } from "vitest";
import { productsUsingGroup, isActiveMember } from "./ingredientGroups";
import type { IngredientGroup, InventoryItem, Product } from "../types";

const group: IngredientGroup = {
  id: "grp_ap_flour",
  name: "All-Purpose Flour",
  category: "Dry Goods",
  activeItemId: "inv_flour_b",
  active: true,
  members: [
    { id: "inv_flour", name: "King Arthur AP", category: "Dry Goods", quantity: 10, unit: "lb", reorderLevel: 5, costPerUnit: 0.5, supplier: "" },
    { id: "inv_flour_b", name: "Great Value AP", category: "Dry Goods", quantity: 20, unit: "lb", reorderLevel: 5, costPerUnit: 0.4, supplier: "" },
  ] as InventoryItem[],
  usedBy: [],
};

const products = [
  { id: "prod_bolillos", name: "Bolillos", recipe: [{ inventoryItemId: "inv_flour", qtyPerUnit: 0.15 }] },
  { id: "prod_conchas", name: "Conchas", recipe: [{ inventoryItemId: "inv_flour_b", qtyPerUnit: 0.12 }] },
  { id: "prod_cookie", name: "Cookie", recipe: [{ inventoryItemId: "inv_choc_chips", qtyPerUnit: 0.08 }] },
] as unknown as Product[];

describe("productsUsingGroup", () => {
  it("returns products whose recipe references any member id", () => {
    expect(productsUsingGroup(group, products)).toEqual(["Bolillos", "Conchas"]);
  });
});

describe("isActiveMember", () => {
  it("is true only for the group's active item", () => {
    expect(isActiveMember(group.members[1], group)).toBe(true);
    expect(isActiveMember(group.members[0], group)).toBe(false);
  });
});