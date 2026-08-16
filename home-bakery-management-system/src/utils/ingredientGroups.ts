import type { IngredientGroup, InventoryItem, Product } from "../types";

// Names of products whose recipe references any member of the group — i.e. the
// products that would switch when this group's active item changes.
export function productsUsingGroup(group: IngredientGroup, products: Product[]): string[] {
  const memberIds = new Set(group.members.map((m) => m.id));
  return products
    .filter((p) => (p.recipe || []).some((r) => memberIds.has(r.inventoryItemId)))
    .map((p) => p.name);
}

export function isActiveMember(item: InventoryItem, group: IngredientGroup): boolean {
  return !!group.activeItemId && item.id === group.activeItemId;
}