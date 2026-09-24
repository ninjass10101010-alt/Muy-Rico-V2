import type { InventoryItem } from "../types";

export type InventoryStatusFilter = "all" | "low" | "out";
export type InventorySortKey = "name" | "quantity" | "reorderLevel" | "costPerUnit";

export interface InventoryTableQuery {
  search?: string;
  status?: InventoryStatusFilter;
  category?: string | null;
  sortKey?: InventorySortKey | null;
  sortDir?: "asc" | "desc";
}

export function filterAndSortInventory(items: InventoryItem[], query: InventoryTableQuery): InventoryItem[] {
  const search = (query.search || "").trim().toLowerCase();
  const status = query.status || "all";
  const category = query.category || null;

  const filtered = items.filter((item) => {
    if (search && !item.name.toLowerCase().includes(search)) return false;
    if (category && item.category !== category) return false;
    if (status === "low" && !(item.quantity <= item.reorderLevel)) return false;
    if (status === "out" && !(item.quantity <= 0)) return false;
    return true;
  });

  const sortKey = query.sortKey;
  if (!sortKey) return filtered;

  const direction = query.sortDir === "desc" ? -1 : 1;
  return [...filtered].sort((a, b) => {
    if (sortKey === "name") return direction * a.name.localeCompare(b.name);
    return direction * (a[sortKey] - b[sortKey]);
  });
}

export function distinctInventoryValues(
  items: Pick<InventoryItem, "category" | "unit">[],
  key: "category" | "unit",
): string[] {
  const values = new Set<string>();
  for (const item of items) {
    const value = (item[key] || "").trim();
    if (value) values.add(value);
  }
  return [...values].sort((a, b) => a.localeCompare(b));
}
