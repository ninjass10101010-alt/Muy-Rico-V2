import type { IngredientGroup } from "../types";

export type GroupChoice =
  | { kind: "none" }
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string };

export function GroupPicker({ groups, choice, setChoice, makeActive, setMakeActive, canMakeActive }: {
  groups: IngredientGroup[];
  choice: GroupChoice;
  setChoice: (c: GroupChoice) => void;
  makeActive: boolean;
  setMakeActive: (b: boolean) => void;
  canMakeActive: boolean;
}) {
  const selectValue =
    choice.kind === "existing" ? choice.id : choice.kind === "new" ? "__new__" : "";
  return (
    <div className="space-y-2">
      <label className="mb-1 block text-xs font-medium text-stone-500">
        What is this used for?
      </label>
      <select
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") setChoice({ kind: "none" });
          else if (v === "__new__") setChoice({ kind: "new", name: "" });
          else setChoice({ kind: "existing", id: v });
          setMakeActive(false);
        }}
        className="w-full rounded-lg border border-stone-300 px-3 py-2"
      >
        <option value="">Standalone (not linked to an ingredient)</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
            {g.usedBy.length ? ` — used in: ${g.usedBy.join(", ")}` : ""}
          </option>
        ))}
        <option value="__new__">Create new ingredient group…</option>
      </select>
      {choice.kind === "new" && (
        <input
          autoFocus
          type="text"
          value={choice.name}
          onChange={(e) => setChoice({ kind: "new", name: e.target.value })}
          placeholder="e.g. All-Purpose Flour"
          className="w-full rounded-lg border border-stone-300 px-3 py-2"
        />
      )}
      {canMakeActive && (
        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input
            type="checkbox"
            checked={makeActive}
            onChange={(e) => setMakeActive(e.target.checked)}
          />
          Use for all products (make active)
        </label>
      )}
    </div>
  );
}