import type { InventoryItem, Product } from "../types";

/**
 * Calculate cost-to-make from a product's recipe and current inventory costs.
 * Returns 0 if recipe is empty or no inventory items match.
 */
export function calcRecipeCost(
  recipe: Product["recipe"],
  inventory: InventoryItem[],
): number {
  let total = 0;
  for (const rec of recipe) {
    const item = inventory.find((i) => i.id === rec.inventoryItemId);
    if (item) {
      total += rec.qtyPerUnit * item.costPerUnit;
    }
  }
  return Math.round(total * 100) / 100;
}
