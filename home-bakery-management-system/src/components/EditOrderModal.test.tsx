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
});
