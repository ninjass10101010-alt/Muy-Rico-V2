import { describe, expect, it } from "vitest";
import { computePrepList, packMultiplierFor } from "./prepList";
import type { InventoryItem, Order, Product } from "../types";

const flour: InventoryItem = { id: "inv-flour", name: "Flour (AP)", category: "Dry Goods", quantity: 6, unit: "cup", reorderLevel: 5, costPerUnit: 1, supplier: "", active: true };
const eggs: InventoryItem = { id: "inv-eggs", name: "Eggs", category: "Dairy", quantity: 24, unit: "each", reorderLevel: 10, costPerUnit: 0.3, supplier: "", active: true };
const retired: InventoryItem = { id: "inv-ret", name: "Retired Butter", category: "Dairy", quantity: 0, unit: "lb", reorderLevel: 1, costPerUnit: 1, supplier: "", active: false };

const conchas: Product = {
  id: "prod-conchas", name: "Conchas", category: "Pan", price: 2, cost: 1, sku: "C", emoji: "🍞", active: true,
  description: "", ingredients: "", allergens: "",
  recipe: [
    { inventoryItemId: "inv-flour", qtyPerUnit: 1.5 },
    { inventoryItemId: "inv-eggs", qtyPerUnit: 1 },
    { inventoryItemId: "inv-ret", qtyPerUnit: 0.5 },
  ],
};

const cupcake: Product = {
  id: "prod-cup", name: "Cupcakes", category: "Postres", price: 3, cost: 1, sku: "CU", emoji: "🧁", active: true,
  description: "", ingredients: "", allergens: "",
  recipe: [{ inventoryItemId: "inv-flour", qtyPerUnit: 0.5 }],
  pack_sizes: [
    { id: "ps6", label: "6-pack", qty: 6, price: 15 },
    { id: "ps12", label: "12-pack", qty: 12, price: 28 },
  ],
};

const noRecipe: Product = {
  id: "prod-norecipe", name: "Custom Cake", category: "Cake", price: 50, cost: 10, sku: "CC", emoji: "🎂", active: true,
  description: "", ingredients: "", allergens: "", recipe: [],
};

const noProduct: Product = { ...conchas, id: "prod-other", name: "Other", sku: "O", recipe: [] };

function mkOrder(partial: Partial<Order>): Order {
  return {
    id: "1", orderNumber: "MR-1", customerId: null, customerName: "Test", phone: "", items: [],
    source: "website", status: "pending", paymentMethod: null, paymentSubMethod: null, paymentStatus: "unpaid",
    subtotal: 0, discount: 0, total: 0, dueDate: "2026-06-11T10:00:00.000Z", createdAt: "2026-06-01T00:00:00.000Z",
    notes: "", inventoryDeducted: false, foodColoring: null, ...partial,
  };
}

describe("packMultiplierFor", () => {
  it("returns 1 when the product has no pack sizes", () => {
    expect(packMultiplierFor({ price: 2 }, conchas)).toBe(1);
  });

  it("matches a pack by price", () => {
    expect(packMultiplierFor({ price: 15 }, cupcake)).toBe(6);
    expect(packMultiplierFor({ price: 28 }, cupcake)).toBe(12);
  });

  it("falls back to 1 when no pack price matches", () => {
    expect(packMultiplierFor({ price: 3 }, cupcake)).toBe(1);
  });
});

describe("computePrepList", () => {
  const window = ["2026-06-11", "2026-06-12"] as const;

  it("aggregates needs across orders and products", () => {
    const orders = [
      mkOrder({ id: "1", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-conchas", name: "Conchas", emoji: "🍞", qty: 12, price: 2 }] }),
      mkOrder({ id: "2", dueDate: "2026-06-12T10:00:00.000Z", items: [{ productId: "prod-cup", name: "Cupcakes", emoji: "🧁", qty: 1, price: 15 }] }),
    ];
    const r = computePrepList(orders, [conchas, cupcake], [flour, eggs], window[0], window[1]);
    const flourNeed = r.needs.find((n) => n.inventoryItemId === "inv-flour")!;
    expect(flourNeed.need).toBeCloseTo(12 * 1.5 + 6 * 0.5); // 21
    expect(flourNeed.have).toBe(6);
    expect(flourNeed.short).toBeCloseTo(15);
    expect(flourNeed.ok).toBe(false);
    const eggsNeed = r.needs.find((n) => n.inventoryItemId === "inv-eggs")!;
    expect(eggsNeed.need).toBe(12);
    expect(eggsNeed.ok).toBe(true);
  });

  it("excludes cancelled orders and orders outside the window", () => {
    const orders = [
      mkOrder({ id: "cancelled", status: "cancelled", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-conchas", name: "Conchas", emoji: "🍞", qty: 100, price: 2 }] }),
      mkOrder({ id: "outside", dueDate: "2026-06-20T10:00:00.000Z", items: [{ productId: "prod-conchas", name: "Conchas", emoji: "🍞", qty: 100, price: 2 }] }),
    ];
    const r = computePrepList(orders, [conchas], [flour], window[0], window[1]);
    expect(r.needs).toHaveLength(0);
    expect(r.ordersCovered).toHaveLength(0);
  });

  it("collects items whose product has no recipe into withoutRecipe", () => {
    const orders = [
      mkOrder({ id: "1", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-norecipe", name: "Custom Cake", emoji: "🎂", qty: 1, price: 50 }] }),
      mkOrder({ id: "2", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-other", name: "Other", emoji: "🍞", qty: 3, price: 2 }] }),
    ];
    const r = computePrepList(orders, [noRecipe, noProduct], [flour], window[0], window[1]);
    expect(r.withoutRecipe).toHaveLength(2);
    expect(r.withoutRecipe[0].productId).toBe("prod-norecipe");
    expect(r.needs).toHaveLength(0);
  });

  it("flags inactive inventory items", () => {
    const orders = [
      mkOrder({ id: "1", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-conchas", name: "Conchas", emoji: "🍞", qty: 1, price: 2 }] }),
    ];
    const r = computePrepList(orders, [conchas], [retired, flour, eggs], window[0], window[1]);
    const ret = r.needs.find((n) => n.inventoryItemId === "inv-ret")!;
    expect(ret.inactive).toBe(true);
  });

  it("returns empty result for empty orders", () => {
    const r = computePrepList([], [conchas], [flour], window[0], window[1]);
    expect(r.needs).toEqual([]);
    expect(r.withoutRecipe).toEqual([]);
  });
});
