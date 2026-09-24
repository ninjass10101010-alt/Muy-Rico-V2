import { useCallback, useEffect, useRef, useState } from "react";
import { updateInventoryItem } from "../utils/api";
import { useStore } from "../context/StoreContext";
import { useToast } from "../components/ui/Toast";
import type { InventoryItem } from "../types";

const DEBOUNCE_MS = 800;

const clampQuantity = (value: number) => Math.max(0, +(value).toFixed(2));

interface PendingEntry {
  quantity: number;
  baseline: number;
}

export function useOptimisticInventoryAdjust() {
  const { inventory, setInventory } = useStore();
  const toast = useToast();

  const inventoryRef = useRef<InventoryItem[]>(inventory);
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  const pending = useRef(new Map<string, PendingEntry>());
  const timers = useRef(new Map<string, number>());
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);

  const markDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((current) => {
      if (dirty) return current.includes(id) ? current : [...current, id];
      return current.filter((entry) => entry !== id);
    });
  }, []);

  const persist = useCallback(
    async (id: string) => {
      const entry = pending.current.get(id);
      if (!entry) return;
      pending.current.delete(id);
      timers.current.delete(id);
      try {
        await updateInventoryItem(id, { quantity: entry.quantity } as never);
      } catch (err) {
        const message = err instanceof Error ? err.message : "request failed";
        setInventory((items) =>
          items.map((item) => (item.id === id ? { ...item, quantity: entry.baseline } : item)),
        );
        const name = inventoryRef.current.find((item) => item.id === id)?.name || id;
        toast.error(`Couldn't update "${name}": ${message} — change reverted`);
      } finally {
        markDirty(id, false);
      }
    },
    [setInventory, toast, markDirty],
  );

  const applyLocal = useCallback(
    (id: string, quantity: number) => {
      setInventory((items) => items.map((item) => (item.id === id ? { ...item, quantity } : item)));
      const existing = pending.current.get(id);
      const baseline = existing
        ? existing.baseline
        : (inventoryRef.current.find((item) => item.id === id)?.quantity ?? quantity);
      pending.current.set(id, { quantity, baseline });
      const activeTimer = timers.current.get(id);
      if (activeTimer) window.clearTimeout(activeTimer);
      timers.current.set(
        id,
        window.setTimeout(() => {
          void persist(id);
        }, DEBOUNCE_MS),
      );
    },
    [setInventory, persist],
  );

  const adjust = useCallback(
    (id: string, delta: number) => {
      const current = inventoryRef.current.find((item) => item.id === id)?.quantity ?? 0;
      const next = clampQuantity(current + delta);
      if (next === current) return;
      markDirty(id, true);
      applyLocal(id, next);
    },
    [markDirty, applyLocal],
  );

  const restock = useCallback(
    (id: string, amount: number) => {
      const current = inventoryRef.current.find((item) => item.id === id)?.quantity ?? 0;
      markDirty(id, true);
      applyLocal(id, clampQuantity(current + amount));
    },
    [markDirty, applyLocal],
  );

  useEffect(() => {
    const pendingMap = pending.current;
    const timerMap = timers.current;
    return () => {
      for (const timer of timerMap.values()) window.clearTimeout(timer);
      timerMap.clear();
      for (const [id, entry] of pendingMap) {
        void updateInventoryItem(id, { quantity: entry.quantity } as never).catch(() => {});
      }
      pendingMap.clear();
    };
  }, []);

  return { adjust, restock, dirtyIds };
}
