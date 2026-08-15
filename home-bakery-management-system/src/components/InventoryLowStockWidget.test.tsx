import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import InventoryLowStockWidget from "./InventoryLowStockWidget";
import type { InventoryItem } from "../types";

vi.mock("../context/StoreContext", () => ({ useStore: vi.fn() }));

import { useStore } from "../context/StoreContext";

const mockedUseStore = useStore as unknown as ReturnType<typeof vi.fn>;

const mkItem = (partial: Partial<InventoryItem>): InventoryItem => ({
  id: "inv-1", name: "Flour", category: "Dry Goods", quantity: 2, unit: "lb",
  reorderLevel: 5, costPerUnit: 1, supplier: "", active: true, ...partial,
});

function renderWidget(inventory: InventoryItem[]) {
  const apiUpdateInventoryItem = vi.fn().mockResolvedValue(undefined);
  mockedUseStore.mockReturnValue({ inventory, apiUpdateInventoryItem });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<InventoryLowStockWidget onManageInventory={() => {}} />));
  return { container, root, apiUpdateInventoryItem };
}

function cleanup(root: ReturnType<typeof createRoot>, container: HTMLElement) {
  act(() => root.unmount());
  container.remove();
}

function click(container: HTMLElement, selector: string) {
  const el = container.querySelector<HTMLButtonElement>(selector);
  expect(el).toBeTruthy();
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function clickByText(container: HTMLElement, text: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);
  expect(btn).toBeTruthy();
  act(() => btn!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function setNumberInput(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="number"]');
  expect(input).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input!.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

describe("InventoryLowStockWidget", () => {
  beforeEach(() => mockedUseStore.mockReset());

  it("renders low-stock rows sorted by severity and skips healthy items", () => {
    const { container, root } = renderWidget([
      mkItem({ id: "ok", name: "Healthy", quantity: 10, reorderLevel: 5 }),
      mkItem({ id: "zero", name: "Empty Box", quantity: 0, reorderLevel: 2 }),
      mkItem({ id: "low", name: "Almost Out", quantity: 1, reorderLevel: 10 }),
    ]);
    const text = container.textContent ?? "";
    expect(text).not.toContain("Healthy");
    expect(text.indexOf("Empty Box")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("Empty Box")).toBeLessThan(text.indexOf("Almost Out"));
    expect(text).toContain("Out");
    expect(text).toContain("Low");
    expect(text).toContain("(2)");
    cleanup(root, container);
  });

  it("shows the empty state when nothing is low", () => {
    const { container, root } = renderWidget([
      mkItem({ id: "ok", name: "Healthy", quantity: 10, reorderLevel: 5 }),
    ]);
    expect(container.textContent).toContain("All stocked up");
    cleanup(root, container);
  });

  it("increments stock when the + stepper is clicked", async () => {
    const { container, root, apiUpdateInventoryItem } = renderWidget([
      mkItem({ id: "zero", name: "Empty Box", quantity: 0, reorderLevel: 2 }),
    ]);
    click(container, 'button[aria-label="Increase Empty Box"]');
    await flush();
    expect(apiUpdateInventoryItem).toHaveBeenCalledWith("zero", { quantity: 1 });
    cleanup(root, container);
  });

  it("disables the − stepper at zero stock", () => {
    const { container, root } = renderWidget([
      mkItem({ id: "zero", name: "Empty Box", quantity: 0, reorderLevel: 2 }),
    ]);
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Decrease Empty Box"]');
    expect(btn?.disabled).toBe(true);
    cleanup(root, container);
  });

  it("restock dialog adds the received amount to current stock", async () => {
    const { container, root, apiUpdateInventoryItem } = renderWidget([
      mkItem({ id: "f", name: "Flour", quantity: 2, reorderLevel: 5 }),
    ]);
    click(container, 'button[aria-label="Restock Flour"]');
    expect(container.textContent).toContain("Current stock");
    setNumberInput(container, "3");
    clickByText(container, "Add to stock");
    await flush();
    expect(apiUpdateInventoryItem).toHaveBeenCalledWith("f", { quantity: 5 });
    cleanup(root, container);
  });

  it("rejects a non-positive restock amount and shows an error", async () => {
    const { container, root, apiUpdateInventoryItem } = renderWidget([
      mkItem({ id: "f", name: "Flour", quantity: 2, reorderLevel: 5 }),
    ]);
    click(container, 'button[aria-label="Restock Flour"]');
    setNumberInput(container, "0");
    clickByText(container, "Add to stock");
    await flush();
    expect(apiUpdateInventoryItem).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a positive amount received");
    cleanup(root, container);
  });

  it("shows a +N more footer when more than 8 items are low", () => {
    const items = Array.from({ length: 10 }, (_, n) =>
      mkItem({ id: `i${n}`, name: `Item ${n}`, quantity: 0, reorderLevel: 1 }),
    );
    const { container, root } = renderWidget(items);
    expect(container.textContent).toContain("+2 more");
    expect(container.textContent).not.toContain("Item 9");
    cleanup(root, container);
  });
});