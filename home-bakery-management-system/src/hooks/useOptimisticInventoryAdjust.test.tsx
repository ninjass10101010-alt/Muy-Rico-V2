import { useMemo, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOptimisticInventoryAdjust } from "./useOptimisticInventoryAdjust";
import type { InventoryItem } from "../types";
import { useStore } from "../context/StoreContext";
import { useToast } from "../components/ui/Toast";
import { updateInventoryItem } from "../utils/api";

vi.mock("../context/StoreContext", () => ({ useStore: vi.fn() }));
vi.mock("../components/ui/Toast", () => ({ useToast: vi.fn() }));
vi.mock("../utils/api", () => ({ updateInventoryItem: vi.fn() }));

const mockedUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
const mockedUseToast = useToast as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = updateInventoryItem as unknown as ReturnType<typeof vi.fn>;

const toastError = vi.fn();
const toastSuccess = vi.fn();

const mkItem = (partial: Partial<InventoryItem>): InventoryItem => ({
  id: "inv-1",
  name: "Flour",
  category: "Dry Goods",
  quantity: 2,
  unit: "lb",
  reorderLevel: 5,
  costPerUnit: 1,
  supplier: "",
  active: true,
  ...partial,
});

let hook: ReturnType<typeof useOptimisticInventoryAdjust>;
let getInventory: () => InventoryItem[] = () => [];

function renderHook(initial: InventoryItem[]) {
  function Harness() {
    const [inventory, setInventory] = useState(initial);
    const store = useMemo(
      () => ({ inventory, setInventory, refreshInventory: vi.fn() }),
      [inventory],
    );
    mockedUseStore.mockImplementation(() => store);
    mockedUseToast.mockImplementation(() => ({ success: toastSuccess, error: toastError }));
    getInventory = () => inventory;
    hook = useOptimisticInventoryAdjust();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<Harness />));
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function advanceDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useOptimisticInventoryAdjust", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockedUseStore.mockReset();
    mockedUseToast.mockReset();
    mockedUpdate.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    mockedUpdate.mockResolvedValue({ ok: true });
  });

  it("updates the local quantity immediately without calling the API", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook([mkItem({ quantity: 2 })]);
    act(() => hook.adjust("inv-1", 1));
    expect(getInventory()[0].quantity).toBe(3);
    expect(mockedUpdate).not.toHaveBeenCalled();
    unmount();
  });

  it("coalesces rapid clicks into a single PATCH with the final total", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook([mkItem({ quantity: 2 })]);
    act(() => hook.adjust("inv-1", 1));
    act(() => hook.adjust("inv-1", 1));
    act(() => hook.adjust("inv-1", 1));
    expect(getInventory()[0].quantity).toBe(5);
    expect(mockedUpdate).not.toHaveBeenCalled();
    await advanceDebounce();
    expect(mockedUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUpdate).toHaveBeenCalledWith("inv-1", { quantity: 5 });
    unmount();
  });

  it("tracks dirty ids while pending and clears them after success", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook([mkItem({ quantity: 2 })]);
    act(() => hook.adjust("inv-1", 1));
    expect(hook.dirtyIds).toEqual(["inv-1"]);
    await advanceDebounce();
    expect(hook.dirtyIds).toEqual([]);
    unmount();
  });

  it("rolls back and toasts when the PATCH fails", async () => {
    vi.useFakeTimers();
    mockedUpdate.mockRejectedValueOnce(new Error("network down"));
    const { unmount } = renderHook([mkItem({ quantity: 2 })]);
    act(() => hook.adjust("inv-1", 1));
    expect(getInventory()[0].quantity).toBe(3);
    await advanceDebounce();
    expect(getInventory()[0].quantity).toBe(2);
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining("network down"));
    expect(hook.dirtyIds).toEqual([]);
    unmount();
  });

  it("flushes a pending save on unmount", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook([mkItem({ quantity: 2 })]);
    act(() => hook.adjust("inv-1", 2));
    expect(mockedUpdate).not.toHaveBeenCalled();
    unmount();
    await flush();
    expect(mockedUpdate).toHaveBeenCalledWith("inv-1", { quantity: 4 });
  });

  it("never lets quantity fall below zero", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook([mkItem({ quantity: 1 })]);
    act(() => hook.adjust("inv-1", -5));
    expect(getInventory()[0].quantity).toBe(0);
    await advanceDebounce();
    expect(mockedUpdate).toHaveBeenCalledWith("inv-1", { quantity: 0 });
    unmount();
  });

  it("restocks by adding the received amount", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook([mkItem({ quantity: 2 })]);
    act(() => hook.restock("inv-1", 3));
    expect(getInventory()[0].quantity).toBe(5);
    await advanceDebounce();
    expect(mockedUpdate).toHaveBeenCalledWith("inv-1", { quantity: 5 });
    unmount();
  });

  it("keeps separate debounce timers per item", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook([mkItem({ id: "a", quantity: 2 }), mkItem({ id: "b", quantity: 4 })]);
    act(() => hook.adjust("a", 1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    act(() => hook.adjust("b", 1));
    await advanceDebounce();
    expect(mockedUpdate).toHaveBeenCalledWith("a", { quantity: 3 });
    expect(mockedUpdate).toHaveBeenCalledWith("b", { quantity: 5 });
    unmount();
  });
});
