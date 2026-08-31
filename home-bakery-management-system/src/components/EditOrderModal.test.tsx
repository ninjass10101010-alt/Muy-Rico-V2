import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import EditOrderModal from "./EditOrderModal";
import type { Order } from "../types";

const mockApiUpdateOrder = vi.fn();

vi.mock("../context/StoreContext", () => ({
  useStore: () => ({
    products: [
      { id: "prod_cupcakes", name: "Cupcakes", emoji: "🧁", active: true, price: 3, flavor_groups: [], pack_sizes: [] },
    ],
    apiUpdateOrder: mockApiUpdateOrder,
  }),
}));

const mkOrder = (partial: Partial<Order>): Order => ({
  id: "7", orderNumber: "MR-7", customerId: null, customerName: "Gena Romain", phone: "555",
  items: [{ productId: "prod_cupcakes", name: "Cupcakes (Vanilla)", emoji: "🧁", qty: 12, price: 3.5 }],
  source: "website", status: "pending", paymentMethod: null, paymentSubMethod: null, paymentStatus: "partial",
  subtotal: 42, discount: 0, total: 42, dueDate: "2026-09-05", createdAt: "2026-08-31", notes: "",
  inventoryDeducted: false, foodColoring: null, ...partial,
});

const mkSingleItemOrder = (): Order =>
  mkOrder({
    items: [{ productId: "prod_cupcakes", name: "Cupcakes (Vanilla)", emoji: "🧁", qty: 1, price: 3.5 }],
    subtotal: 3.5, discount: 0, total: 3.5,
  });

function render(order: Order | null, open = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<EditOrderModal open={open} order={order} onClose={() => {}} onSaved={() => {}} />);
  });
  return { text: container.textContent ?? "", root, container };
}

function clickButton(container: HTMLElement, iconClass: string) {
  const btn = container.querySelector(`svg.${iconClass}`)?.closest("button") as HTMLButtonElement | null;
  expect(btn).not.toBeNull();
  act(() => {
    btn!.click();
  });
}

function qtySpans(container: HTMLElement) {
  return Array.from(container.querySelectorAll("span.w-5"));
}

function setDiscountInput(container: HTMLElement, value: string) {
  const inputs = container.querySelectorAll<HTMLInputElement>('input[type="number"]');
  const discountInput = inputs[inputs.length - 1];
  expect(discountInput).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(discountInput, value);
    discountInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function typePrice(container: HTMLElement, value: string) {
  const priceInput = container.querySelector<HTMLInputElement>('input[type="number"]');
  expect(priceInput).toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  for (let i = 1; i <= value.length; i++) {
    const chunk = value.slice(0, i);
    act(() => {
      setter.call(priceInput!, chunk);
      priceInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

function saveButton(container: HTMLElement) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Save Changes");
  expect(btn).toBeTruthy();
  return btn as HTMLButtonElement;
}

describe("EditOrderModal", () => {
  it("renders existing item rows with qty and price", () => {
    const { text, root, container } = render(mkOrder({}));
    expect(text).toContain("Cupcakes (Vanilla)");
    expect(text).toContain("12");
    const priceInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(priceInput.value).toBe("3.5");
    root.unmount();
    container.remove();
  });

  it("recomputes the total when qty changes", () => {
    const { text, root, container } = render(mkOrder({}));
    expect(text).toContain("$42.00");
    clickButton(container, "lucide-plus");
    expect(qtySpans(container)[0]?.textContent).toBe("13");
    expect(container.textContent).toContain("$45.50");
    root.unmount();
    container.remove();
  });

  it("floors the qty at 1 when the stepper is decremented", () => {
    const { text, root, container } = render(mkSingleItemOrder());
    expect(text).toContain("$3.50");
    clickButton(container, "lucide-minus");
    expect(qtySpans(container)[0]?.textContent).toBe("1");
    expect(container.textContent).toContain("$3.50");
    root.unmount();
    container.remove();
  });

  it("keeps the last item: remove button is disabled with one item", () => {
    const { root, container } = render(mkSingleItemOrder());
    const removeBtn = container.querySelector("svg.lucide-trash-2")?.closest("button") as HTMLButtonElement | null;
    expect(removeBtn?.disabled).toBe(true);
    act(() => {
      removeBtn!.click();
    });
    expect(qtySpans(container).length).toBe(1);
    root.unmount();
    container.remove();
  });

  it("ignores partial/NaN discount input instead of showing $NaN", () => {
    const { text, root, container } = render(mkOrder({}));
    expect(text).toContain("$42.00");
    setDiscountInput(container, "e");
    expect(container.textContent).toContain("$42.00");
    expect(container.textContent).not.toContain("$NaN");
    root.unmount();
    container.remove();
  });

  it("shows the inventory banner when inventory was already deducted", () => {
    const { text, root, container } = render(mkOrder({ inventoryDeducted: true }));
    expect(text).toContain("Inventory was already deducted");
    root.unmount();
    container.remove();
  });

  it("renders nothing when closed", () => {
    const { text, root, container } = render(mkOrder({}), false);
    expect(text).toBe("");
    root.unmount();
    container.remove();
  });

  it("keeps the decimal draft while typing a price like 3.50", () => {
    const { root, container } = render(mkOrder({
      items: [{ productId: "prod_cupcakes", name: "Cupcakes (Vanilla)", emoji: "🧁", qty: 12, price: 4 }],
      subtotal: 48, discount: 0, total: 48,
    }));
    expect(container.textContent).toContain("$48.00");
    typePrice(container, "3.50");
    const priceInput = container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(priceInput!.value).toBe("3.50");
    expect(container.textContent).toContain("$42.00");
    root.unmount();
    container.remove();
  });

  it("sends items_json and discount_cents in the save payload", async () => {
    const { root, container } = render(mkOrder({}));
    mockApiUpdateOrder.mockResolvedValueOnce(undefined);
    await act(async () => {
      saveButton(container).click();
    });
    expect(mockApiUpdateOrder).toHaveBeenCalledWith(7, {
      items_json: [{ name: "Cupcakes (Vanilla)", qty: 12, price: 3.5, productId: "prod_cupcakes", emoji: "🧁", flavorNote: undefined }],
      discount_cents: 0,
    });
    root.unmount();
    container.remove();
  });

  it("shows the server inline error and keeps the modal open", async () => {
    const { root, container } = render(mkOrder({}));
    mockApiUpdateOrder.mockRejectedValueOnce(new Error("Item 1 quantity must be an integer between 1 and 9999"));
    await act(async () => {
      saveButton(container).click();
    });
    expect(container.textContent).toContain("Item 1 quantity must be an integer between 1 and 9999");
    expect(container.textContent).toContain("Cupcakes (Vanilla)");
    root.unmount();
    container.remove();
  });
});
