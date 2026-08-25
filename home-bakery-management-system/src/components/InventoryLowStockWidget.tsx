import { useMemo, useState } from "react";
import { Minus, PackageX, Plus } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "./ui/Modal";
import Badge from "./ui/Badge";
import { sortLowStock } from "../utils/lowStock";
import type { InventoryItem } from "../types";

const MAX_ROWS = 8;

export default function InventoryLowStockWidget({ onManageInventory }: { onManageInventory: () => void }) {
  const { inventory, apiUpdateInventoryItem } = useStore();
  const [restockItem, setRestockItem] = useState<InventoryItem | null>(null);
  const [received, setReceived] = useState("");
  const [restockErr, setRestockErr] = useState("");
  const [rowErr, setRowErr] = useState<string | null>(null);

  const visible = useMemo(() => sortLowStock(inventory, MAX_ROWS), [inventory]);
  const totalLow = useMemo(() => sortLowStock(inventory).length, [inventory]);
  const hiddenCount = Math.max(0, totalLow - visible.length);

  async function step(item: InventoryItem, delta: number) {
    const next = Math.max(0, +(item.quantity + delta).toFixed(2));
    if (next === item.quantity) return;
    setRowErr(null);
    try {
      await apiUpdateInventoryItem(item.id, { quantity: next });
    } catch (err: any) {
      setRowErr(`Couldn't update "${item.name}": ${err?.message || "request failed"}`);
    }
  }

  function openRestock(item: InventoryItem) {
    setRestockItem(item);
    setReceived("");
    setRestockErr("");
  }

  async function submitRestock() {
    if (!restockItem) return;
    const amount = Number(received);
    if (!received.trim() || !Number.isFinite(amount) || amount <= 0) {
      setRestockErr("Enter a positive amount received.");
      return;
    }
    try {
      await apiUpdateInventoryItem(restockItem.id, { quantity: +(restockItem.quantity + amount).toFixed(2) });
      setRestockItem(null);
    } catch (err: any) {
      setRestockErr(`Failed to restock: ${err?.message || err}`);
    }
  }

  return (
    <div className="rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-sand-100 px-5 py-4">
        <h3 className="font-serif text-base font-semibold text-cocoa">
          Low stock
          {totalLow > 0 && <span className="ml-1.5 text-hibiscus">({totalLow})</span>}
        </h3>
        <button onClick={onManageInventory} className="text-xs font-medium text-coral hover:underline">
          Manage inventory →
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
          <PackageX size={22} className="text-palm" />
          <p className="text-sm text-cocoa-muted">All stocked up — nothing is low right now.</p>
        </div>
      ) : (
        <div className="divide-y divide-sand-100">
          {visible.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cocoa">{i.name}</p>
                <p className="text-xs text-cocoa-muted">
                  {i.quantity} {i.unit} left · reorder at {i.reorderLevel} {i.unit}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={i.quantity <= 0 ? "out" : "low"}>{i.quantity <= 0 ? "Out" : "Low"}</Badge>
                <button
                  onClick={() => step(i, -1)}
                  disabled={i.quantity <= 0}
                  aria-label={`Decrease ${i.name}`}
                  className="rounded-md border border-sand-200 p-1 text-cocoa-muted transition hover:bg-sand-100 active:scale-[0.99] disabled:opacity-40"
                >
                  <Minus size={12} />
                </button>
                <button
                  onClick={() => step(i, 1)}
                  aria-label={`Increase ${i.name}`}
                  className="rounded-md border border-sand-200 p-1 text-cocoa-muted transition hover:bg-sand-100 active:scale-[0.99]"
                >
                  <Plus size={12} />
                </button>
                <button
                  onClick={() => openRestock(i)}
                  aria-label={`Restock ${i.name}`}
                  className="rounded-lg border border-palm/30 px-2.5 py-1.5 text-xs font-medium text-palm transition hover:bg-palm/5 active:scale-[0.99]"
                >
                  Restock
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {rowErr && (
        <div className="border-t border-sand-100 px-5 py-2.5">
          <p className="text-xs text-hibiscus">{rowErr}</p>
        </div>
      )}

      {hiddenCount > 0 && (
        <div className="border-t border-sand-100 px-5 py-3">
          <button onClick={onManageInventory} className="text-xs font-medium text-coral hover:underline">
            +{hiddenCount} more — view all in Inventory
          </button>
        </div>
      )}

      <Modal
        open={!!restockItem}
        onClose={() => setRestockItem(null)}
        title={restockItem ? `Restock — ${restockItem.name}` : "Restock"}
      >
        <div className="space-y-3">
          <p className="text-sm text-cocoa-muted">
            Current stock: <span className="font-semibold text-cocoa">{restockItem?.quantity} {restockItem?.unit}</span>
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-cocoa-muted">Amount received</label>
            <input
              type="number"
              step="0.01"
              min="0"
              autoFocus
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              className="input"
            />
          </div>
          {restockErr && <p className="text-xs text-hibiscus">{restockErr}</p>}
          <button
            onClick={submitRestock}
            className="w-full rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md"
          >
            Add to stock
          </button>
        </div>
      </Modal>
    </div>
  );
}