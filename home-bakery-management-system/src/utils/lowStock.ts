import type { InventoryItem } from "../types";

export function sortLowStock(items: InventoryItem[], limit?: number): InventoryItem[] {
  const low = items
    .filter((i) => i.quantity <= i.reorderLevel)
    .map((i) => ({ item: i, shortfall: shortfallPct(i) }));
  low.sort((a, b) => {
    const aOut = a.item.quantity <= 0 ? 1 : 0;
    const bOut = b.item.quantity <= 0 ? 1 : 0;
    if (aOut !== bOut) return bOut - aOut;
    if (a.shortfall !== b.shortfall) return b.shortfall - a.shortfall;
    return a.item.name.localeCompare(b.item.name);
  });
  const result = low.map((x) => x.item);
  return limit == null ? result : result.slice(0, limit);
}

function shortfallPct(i: InventoryItem): number {
  if (i.reorderLevel <= 0) return i.quantity <= 0 ? 1 : 0;
  return Math.max(0, (i.reorderLevel - i.quantity) / i.reorderLevel);
}