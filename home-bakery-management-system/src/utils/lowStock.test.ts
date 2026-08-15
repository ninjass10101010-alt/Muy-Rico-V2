import { describe, expect, it } from "vitest";
import { sortLowStock } from "./lowStock";
import type { InventoryItem } from "../types";

const mk = (partial: Partial<InventoryItem>): InventoryItem => ({
  id: "inv-1", name: "Item", category: "Dry Goods", quantity: 1, unit: "each",
  reorderLevel: 5, costPerUnit: 1, supplier: "", active: true, ...partial,
});

describe("sortLowStock", () => {
  it("returns only items at or below reorder level", () => {
    const out = sortLowStock([
      mk({ id: "a", name: "Low", quantity: 2, reorderLevel: 5 }),
      mk({ id: "b", name: "Fine", quantity: 8, reorderLevel: 5 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["a"]);
  });

  it("sorts out-of-stock first, then by shortfall percentage descending, ties alphabetically", () => {
    const out = sortLowStock([
      mk({ id: "a", name: "Zeta", quantity: 3, reorderLevel: 5 }),
      mk({ id: "b", name: "Beta", quantity: 3, reorderLevel: 5 }),
      mk({ id: "c", name: "Empty", quantity: 0, reorderLevel: 2 }),
      mk({ id: "d", name: "Almost", quantity: 1, reorderLevel: 10 }),
    ]);
    expect(out.map((i) => i.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("caps results at the given limit", () => {
    const items = Array.from({ length: 5 }, (_, n) =>
      mk({ id: `i${n}`, name: `Item ${n}`, quantity: 0, reorderLevel: 1 }),
    );
    expect(sortLowStock(items, 3)).toHaveLength(3);
  });
});