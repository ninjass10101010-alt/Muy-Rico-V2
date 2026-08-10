import type { InventoryItem, Order, Product } from "../types";

export interface PrepNeed {
  inventoryItemId: string;
  name: string;
  unit: string;
  need: number;
  have: number;
  short: number;
  ok: boolean;
  inactive: boolean;
  orderIds: string[];
}

export interface PrepLineWithoutRecipe {
  productId: string;
  productName: string;
  qty: number;
}

export interface PrepListResult {
  windowStart: string;
  windowEnd: string;
  needs: PrepNeed[];
  withoutRecipe: PrepLineWithoutRecipe[];
  ordersCovered: Order[];
}

export function packMultiplierFor(orderItem: { price: number }, product: Product): number {
  if (!product.pack_sizes || product.pack_sizes.length === 0) return 1;
  const match = product.pack_sizes.find((p) => Number(p.price) === orderItem.price);
  return match ? match.qty : 1;
}

export function computePrepList(
  orders: Order[],
  products: Product[],
  inventory: InventoryItem[],
  windowStart: string,
  windowEnd: string,
): PrepListResult {
  const invById = new Map(inventory.map((i) => [i.id, i]));
  const needMap = new Map<string, PrepNeed>();
  const withoutRecipe: PrepLineWithoutRecipe[] = [];
  const ordersCovered: Order[] = [];

  const activeOrders = orders.filter((o) => {
    if (o.status === "completed" || o.status === "cancelled") return false;
    const d = o.dueDate.slice(0, 10);
    return d >= windowStart && d <= windowEnd;
  });

  for (const o of activeOrders) {
    let contributes = false;
    for (const item of o.items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product || !product.recipe || product.recipe.length === 0) {
        withoutRecipe.push({ productId: item.productId, productName: item.name, qty: item.qty });
        contributes = true;
        continue;
      }
      const multiplier = packMultiplierFor(item, product);
      const unitQty = item.qty * multiplier;
      for (const line of product.recipe) {
        const entry = needMap.get(line.inventoryItemId);
        const inv = invById.get(line.inventoryItemId);
        const amount = unitQty * line.qtyPerUnit;
        if (entry) {
          entry.need += amount;
          if (!entry.orderIds.includes(o.id)) entry.orderIds.push(o.id);
        } else {
          needMap.set(line.inventoryItemId, {
            inventoryItemId: line.inventoryItemId,
            name: inv?.name ?? line.inventoryItemId,
            unit: inv?.unit ?? "",
            need: amount,
            have: inv?.quantity ?? 0,
            short: 0,
            ok: false,
            inactive: inv ? inv.active === false : false,
            orderIds: [o.id],
          });
        }
        contributes = true;
      }
    }
    if (contributes) ordersCovered.push(o);
  }

  const needs = [...needMap.values()].map((n) => ({
    ...n,
    short: Math.max(0, n.need - n.have),
    ok: n.need <= n.have,
  }));

  needs.sort((a, b) => b.short - a.short || a.name.localeCompare(b.name));

  return { windowStart, windowEnd, needs, withoutRecipe, ordersCovered };
}
