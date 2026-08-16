import { describe, it, expect } from "vitest";
import { rewriteRecipeForGroup } from "../workers/groups-lib.js";

const memberIds = new Set(["inv_flour", "inv_flour_b"]);

describe("rewriteRecipeForGroup", () => {
  it("repoints member lines to the new active id, preserving qtyPerUnit", () => {
    const recipe = [
      { inventoryItemId: "inv_flour", qtyPerUnit: 0.12 },
      { inventoryItemId: "inv_eggs", qtyPerUnit: 1 },
    ];
    expect(rewriteRecipeForGroup(recipe, memberIds, "inv_flour_b")).toEqual([
      { inventoryItemId: "inv_flour_b", qtyPerUnit: 0.12 },
      { inventoryItemId: "inv_eggs", qtyPerUnit: 1 },
    ]);
  });

  it("leaves lines already pointing at the active id untouched", () => {
    const recipe = [{ inventoryItemId: "inv_flour_b", qtyPerUnit: 0.1 }];
    expect(rewriteRecipeForGroup(recipe, memberIds, "inv_flour_b")).toEqual(recipe);
  });

  it("handles empty and non-array input", () => {
    expect(rewriteRecipeForGroup([], memberIds, "x")).toEqual([]);
    expect(rewriteRecipeForGroup(null, memberIds, "x")).toEqual([]);
  });
});