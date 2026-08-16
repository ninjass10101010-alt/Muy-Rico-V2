import { useCallback } from "react";
import { useStore } from "../context/StoreContext";
import { composeLabelFromRecipe } from "../utils/label";
import type { IngredientGroup, InventoryItem } from "../types";

// Activates `item` as the group's active ingredient, then re-saves the label
// fields (ingredients + allergens) of every affected product so the swap is
// reflected in the stored label data immediately.
//
// Callers MUST pass a store-shaped InventoryItem with its label fields
// (ingredients_label, allergens, unit_weight) — see the note below.
export function useIngredientGroups() {
  const { products, inventory, apiUpdateGroup, apiUpdateProduct, refreshProducts, refreshInventory } = useStore();

  const activateItem = useCallback(async (group: IngredientGroup, item: InventoryItem) => {
    const res = await apiUpdateGroup(group.id, { active_item_id: item.id });
    const affected = (res && res.affectedProductIds) || [];
    const memberIds = new Set(group.members.map((m) => m.id));
    // Compose against a virtual inventory that includes the newly activated item
    // with the caller's data. The store snapshot may not contain it yet (e.g. it
    // was just created), and composing without it would silently DROP the
    // ingredient from the affected products' labels.
    const invById = new Map(inventory.map((x) => [x.id, x]));
    invById.set(item.id, item);
    const composedInventory = [...invById.values()];
    let relabeled = 0;
    for (const pid of affected) {
      const prod = products.find((p) => p.id === pid);
      if (!prod || prod.auto_generate_label === false) continue;
      // After the swap every member line resolves to the new active item; mirror
      // that locally (closure products are pre-refresh) before composing.
      const patched: typeof prod = {
        ...prod,
        recipe: (prod.recipe || []).map((r) =>
          memberIds.has(r.inventoryItemId) ? { ...r, inventoryItemId: item.id } : r
        ),
      };
      const composed = composeLabelFromRecipe(patched, composedInventory);
      await apiUpdateProduct(pid, { ingredients: composed.ingredients, allergens: composed.allergens });
      relabeled += 1;
    }
    await refreshProducts();
    await refreshInventory();
    return {
      affected: affected.length,
      relabeled,
      message: `${group.name} → ${item.name}. ${affected.length} product${affected.length === 1 ? "" : "s"} switched, ${relabeled} relabeled.`,
    };
  }, [products, inventory, apiUpdateGroup, apiUpdateProduct, refreshProducts, refreshInventory]);

  return { activateItem };
}