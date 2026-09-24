import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import Inventory from "./Inventory";
import { ToastProvider } from "../components/ui/Toast";
import { ConfirmProvider } from "../components/ui/ConfirmDialog";
import { useStore } from "../context/StoreContext";
import type { InventoryItem } from "../types";

vi.mock("../context/StoreContext", () => ({ useStore: vi.fn() }));
vi.mock("../hooks/useIngredientGroups", () => ({
  useIngredientGroups: () => ({ activateItem: vi.fn().mockResolvedValue({ message: "switched" }) }),
}));
vi.mock("../utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/api")>();
  return { ...actual, updateInventoryItem: vi.fn() };
});

import { updateInventoryItem } from "../utils/api";

const mockedUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
const mockedUpdate = updateInventoryItem as unknown as ReturnType<typeof vi.fn>;

const mkItem = (partial: Partial<InventoryItem>): InventoryItem => ({
  id: "inv-1",
  name: "Flour",
  category: "Dry Goods",
  quantity: 10,
  unit: "lb",
  reorderLevel: 5,
  costPerUnit: 1,
  supplier: "",
  active: true,
  ...partial,
});

interface RenderResult {
  container: HTMLElement;
  apiUpdateInventoryItem: ReturnType<typeof vi.fn>;
  apiDeleteInventoryItem: ReturnType<typeof vi.fn>;
  setInventory: ReturnType<typeof vi.fn>;
  initial: InventoryItem[];
  unmount: () => void;
}

function renderInventory(initial: InventoryItem[], search = ""): RenderResult {
  const apiUpdateInventoryItem = vi.fn().mockResolvedValue(undefined);
  const apiDeleteInventoryItem = vi.fn().mockResolvedValue(undefined);
  const setInventory = vi.fn();
  mockedUseStore.mockImplementation(() => ({
    inventory: initial,
    products: [],
    orders: [],
    groups: [],
    profile: undefined,
    apiCreateInventoryItem: vi.fn().mockResolvedValue({ id: "inv_new" }),
    apiUpdateInventoryItem,
    apiDeleteInventoryItem,
    apiCreateGroup: vi.fn().mockResolvedValue({ id: "grp_new" }),
    setInventory,
  }));

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <ToastProvider>
        <ConfirmProvider>
          <Inventory search={search} />
        </ConfirmProvider>
      </ToastProvider>,
    ),
  );

  return {
    container,
    apiUpdateInventoryItem,
    apiDeleteInventoryItem,
    setInventory,
    initial,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
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

function setSelectValue(container: HTMLElement, value: string) {
  const select = container.querySelector<HTMLSelectElement>("select");
  expect(select).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
  act(() => {
    setter.call(select, value);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

function rowOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("tbody tr"))
    .map((row) => row.querySelector("td > div")?.textContent?.trim() || "")
    .filter((name) => name.length > 0);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const stock = () => [
  mkItem({ id: "f", name: "Flour", category: "Dry Goods", quantity: 2, reorderLevel: 5 }),
  mkItem({ id: "b", name: "Butter", category: "Dairy", quantity: 0, reorderLevel: 3 }),
  mkItem({ id: "v", name: "Vanilla", category: "Flavors", quantity: 9, reorderLevel: 2 }),
];

describe("Inventory filters and sorting", () => {
  beforeEach(() => {
    mockedUseStore.mockReset();
    mockedUpdate.mockReset();
    mockedUpdate.mockResolvedValue({ ok: true });
  });

  it("renders status chip counts", () => {
    const { container, unmount } = renderInventory(stock());
    expect(container.textContent).toContain("All (3)");
    expect(container.textContent).toContain("Low (2)");
    expect(container.textContent).toContain("Out (1)");
    unmount();
  });

  it("filters to low stock items when the Low chip is clicked", () => {
    const { container, unmount } = renderInventory(stock());
    clickByText(container, "Low (2)");
    const names = rowOrder(container);
    expect(names).toContain("Flour");
    expect(names).toContain("Butter");
    expect(names).not.toContain("Vanilla");
    unmount();
  });

  it("filters to out-of-stock items when the Out chip is clicked", () => {
    const { container, unmount } = renderInventory(stock());
    clickByText(container, "Out (1)");
    const names = rowOrder(container);
    expect(names).toEqual(["Butter"]);
    unmount();
  });

  it("filters by category", () => {
    const { container, unmount } = renderInventory(stock());
    setSelectValue(container, "Dairy");
    expect(rowOrder(container)).toEqual(["Butter"]);
    unmount();
  });

  it("combines the topbar search with the category filter", () => {
    const { container, unmount } = renderInventory(stock(), "flour");
    expect(rowOrder(container)).toEqual(["Flour"]);
    setSelectValue(container, "Dairy");
    expect(container.textContent).toContain("No inventory items found");
    unmount();
  });

  it("sorts by quantity ascending then descending", () => {
    const { container, unmount } = renderInventory(stock());
    clickByText(container, "Quantity");
    expect(rowOrder(container)).toEqual(["Butter", "Flour", "Vanilla"]);
    clickByText(container, "Quantity ▴");
    expect(rowOrder(container)).toEqual(["Vanilla", "Flour", "Butter"]);
    unmount();
  });

  it("sorts by name", () => {
    const { container, unmount } = renderInventory(stock());
    clickByText(container, "Item");
    expect(rowOrder(container)).toEqual(["Butter", "Flour", "Vanilla"]);
    unmount();
  });
});

describe("Inventory edit modal", () => {
  beforeEach(() => {
    mockedUseStore.mockReset();
  });

  it("opens on the Basics tab and switches to Label info", () => {
    const { container, unmount } = renderInventory(stock());
    clickByText(container, "Add Item");
    expect(container.textContent).toContain("Supplier");
    expect(container.textContent).not.toContain("Sub-ingredients label");
    clickByText(container, "Label info");
    expect(container.textContent).toContain("Sub-ingredients label");
    expect(container.textContent).not.toContain("Supplier");
    unmount();
  });

  it("returns to Basics from the Label info tab", () => {
    const { container, unmount } = renderInventory(stock());
    clickByText(container, "Add Item");
    clickByText(container, "Label info");
    clickByText(container, "Basics");
    expect(container.textContent).toContain("Supplier");
    unmount();
  });

  it("marks the Label info tab when the draft has no label data", () => {
    const { container, unmount } = renderInventory(stock());
    clickByText(container, "Add Item");
    expect(container.querySelector("button span.bg-hibiscus")).toBeTruthy();
    unmount();
  });

  it("does not mark the tab when the item already has label data", () => {
    const { container, unmount } = renderInventory([
      mkItem({ ingredients_label: "Enriched flour (wheat flour, niacin)" }),
    ]);
    click(container, 'button[aria-label="Edit Flour"]');
    expect(container.querySelector("button span.bg-hibiscus")).toBeFalsy();
    unmount();
  });

  it("suggests existing categories and units from inventory", () => {
    const { container, unmount } = renderInventory(stock());
    clickByText(container, "Add Item");
    const categoryOptions = Array.from(
      container.querySelectorAll("#inventory-category-options option"),
    ).map((o) => o.getAttribute("value"));
    const unitOptions = Array.from(container.querySelectorAll("#inventory-unit-options option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(categoryOptions).toEqual(["Dairy", "Dry Goods", "Flavors"]);
    expect(unitOptions).toEqual(["lb"]);
    unmount();
  });
});

describe("Inventory adjustments", () => {
  beforeEach(() => {
    mockedUseStore.mockReset();
    mockedUpdate.mockReset();
    mockedUpdate.mockResolvedValue({ ok: true });
  });

  it("updates the local quantity optimistically and PATCHes after the debounce", async () => {
    vi.useFakeTimers();
    const { container, setInventory, initial, unmount } = renderInventory([mkItem({ quantity: 10 })]);
    click(container, 'button[aria-label="Increase Flour"]');
    expect(setInventory).toHaveBeenCalledTimes(1);
    const updater = setInventory.mock.calls[0][0] as (items: InventoryItem[]) => InventoryItem[];
    expect(updater(initial).find((i) => i.id === "inv-1")?.quantity).toBe(11);
    expect(mockedUpdate).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(mockedUpdate).toHaveBeenCalledWith("inv-1", { quantity: 11 });
    vi.useRealTimers();
    unmount();
  });

  it("disables the decrease button at zero", () => {
    const { container, unmount } = renderInventory([mkItem({ quantity: 0 })]);
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Decrease Flour"]');
    expect(btn?.disabled).toBe(true);
    unmount();
  });

  it("adds the received amount through the restock dialog", () => {
    const { container, setInventory, initial, unmount } = renderInventory([mkItem({ quantity: 10 })]);
    click(container, 'button[aria-label="Restock Flour"]');
    expect(container.textContent).toContain("Current stock");
    setNumberInput(container, "3");
    clickByText(container, "Add to stock");
    const updater = setInventory.mock.calls[0][0] as (items: InventoryItem[]) => InventoryItem[];
    expect(updater(initial).find((i) => i.id === "inv-1")?.quantity).toBe(13);
    unmount();
  });

  it("rejects a non-positive restock amount", () => {
    const { container, setInventory, unmount } = renderInventory([mkItem({ quantity: 10 })]);
    click(container, 'button[aria-label="Restock Flour"]');
    setNumberInput(container, "0");
    clickByText(container, "Add to stock");
    expect(setInventory).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Enter a positive amount received");
    unmount();
  });
});

describe("Inventory confirmations", () => {
  beforeEach(() => {
    mockedUseStore.mockReset();
  });

  it("asks before deleting and deletes only after confirming", async () => {
    const { container, apiDeleteInventoryItem, unmount } = renderInventory([mkItem({ name: "Flour" })]);
    click(container, 'button[aria-label="Remove Flour"]');
    expect(container.textContent).toContain("Remove Flour?");
    expect(apiDeleteInventoryItem).not.toHaveBeenCalled();
    clickByText(container, "Remove");
    await flush();
    expect(apiDeleteInventoryItem).toHaveBeenCalledWith("inv-1");
    unmount();
  });

  it("does not delete when the confirmation is dismissed", async () => {
    const { container, apiDeleteInventoryItem, unmount } = renderInventory([mkItem({ name: "Flour" })]);
    click(container, 'button[aria-label="Remove Flour"]');
    clickByText(container, "Cancel");
    await flush();
    expect(apiDeleteInventoryItem).not.toHaveBeenCalled();
    unmount();
  });

  it("asks before unbinding a barcode", async () => {
    const { container, apiUpdateInventoryItem, unmount } = renderInventory([
      mkItem({ name: "Flour", barcode: "0123456789" }),
    ]);
    const unbind = Array.from(container.querySelectorAll("button")).find(
      (b) => b.title === "Unbind barcode",
    );
    expect(unbind).toBeTruthy();
    act(() => unbind!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toContain("Unbind barcode");
    clickByText(container, "Unbind");
    await flush();
    expect(apiUpdateInventoryItem).toHaveBeenCalledWith("inv-1", { barcode: null });
    unmount();
  });
});
