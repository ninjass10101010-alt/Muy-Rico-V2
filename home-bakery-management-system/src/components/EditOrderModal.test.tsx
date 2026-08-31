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

function render(order: Order | null, open = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<EditOrderModal open={open} order={order} onClose={() => {}} onSaved={() => {}} />);
  });
  return { text: container.textContent ?? "", root, container };
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