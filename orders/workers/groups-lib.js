// Pure recipe rewrite for ingredient-group "make active". No DB access.
// Recipe lines reference concrete inventory ids; when a group's active item
// changes, every line referencing a member is repointed to the new active id.
export function rewriteRecipeForGroup(recipeArray, memberIds, newActiveId) {
  if (!Array.isArray(recipeArray)) return [];
  return recipeArray.map((rec) => {
    if (rec && rec.inventoryItemId && memberIds.has(rec.inventoryItemId)) {
      return { ...rec, inventoryItemId: newActiveId };
    }
    return rec;
  });
}