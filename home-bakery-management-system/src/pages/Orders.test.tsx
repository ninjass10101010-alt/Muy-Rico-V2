import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import Orders from "./Orders";
import type { Order } from "../types";

const store = {
  orders: [] as Order[],
  products: [
    { id: "prod_cupcakes", name: "Cupcakes", emoji: "🧁", active: true, price: 3, flavor_groups: [], pack_sizes: [] },
  ],
  payments: [] as { id: string; orderId: string; amount: number; method: string; date: string; methodDetails?: string }[],
  customers: [],
  profile: { acceptedMethods: { cash: true } },
  receipts: [],
  apiDeductInventory: vi.fn(),
  recordPayment: vi.fn(),
  apiUpdateOrder: vi.fn(),
  apiDeleteOrder: vi.fn(),
  handleRelinkOrder: vi.fn(),
  refreshOrders: vi.fn(async () => {}),
  refreshPayments: vi.fn(async () => {}),
  refreshLabelTemplates: vi.fn(async () => {}),
  resendReceipt: vi.fn(),
  generateReceipt: vi.fn(),
  handleSendOrderStatement: vi.fn(async () => ({ ok: true })),
  handleSendOverdueStatements: vi.fn(async () => ({ ok: true, sent: 0, failed: 0, skipped: {} })),
};

vi.mock("../context/StoreContext", () => ({
  useStore: () => store,
}));

vi.mock("../utils/api", () => ({
  generateOrderLabels: vi.fn(async () => ({ ok: true })),
  receiptHtmlUrl: () => "",
  fetchOrder: vi.fn(async () => ({ order: {}, events: [] })),
  paidCentsForOrder: () => 0,
  remainingBalanceCents: () => 0,
}));

const mkOrder = (partial: Partial<Order>): Order => ({
  id: "68", orderNumber: "MR-68", customerId: null, customerName: "Laney Nelson", phone: "", email: "", language: "es",
  items: [{ productId: "prod_cupcakes", name: "Cupcakes", emoji: "🧁", qty: 4, price: 10 }],
  source: "in-person", status: "pending", paymentMethod: null, paymentSubMethod: null, paymentStatus: "unpaid",
  subtotal: 40, discount: 0, total: 40, dueDate: "2026-10-19", createdAt: "2026-10-13", notes: "",
  inventoryDeducted: false, foodColoring: null, ...partial,
});

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <Orders
        search=""
        setPage={() => {}}
        setLabelFilter={() => {}}
      />
    );
  });
  return { text: container.textContent ?? "", container, root };
}

function clickByText(container: HTMLElement, label: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  expect(btn, `button "${label}"`).toBeTruthy();
  act(() => { btn!.click(); });
}

describe("Orders unpaid filter", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    store.orders = [
      mkOrder({}),                                                            // unpaid, pending
      mkOrder({ id: "62", orderNumber: "MR-62", customerName: "Jeff Garcia", paymentStatus: "paid" }),
    ];
  });

  it("shows the '1 Unpaid' badge for unpaid orders", () => {
    const { text } = render();
    expect(text).toContain("1 Unpaid");
  });

  it("filters the table to unpaid orders when the badge is clicked", () => {
    const { container } = render();
    clickByText(container, "1 Unpaid");
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("MR-68");
    expect(rows[0].textContent).toContain("Laney Nelson");
    expect(rows[0].textContent).not.toContain("MR-62");
  });

  it("exposes a payment filter that reaches unpaid orders directly", () => {
    const { container } = render();
    const paySelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select"))
      .find((s) => Array.from(s.options).some((o) => o.value === "unpaid"));
    expect(paySelect, "payment filter exists").toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    act(() => { setter.call(paySelect!, "unpaid"); paySelect!.dispatchEvent(new Event("change", { bubbles: true })); });
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("MR-68");
  });
});
