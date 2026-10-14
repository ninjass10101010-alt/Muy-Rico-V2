import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import OrderModal from "./OrderModal";

const mockApiCreateOrder = vi.fn();
const mockCreatePayment = vi.fn();
const mockRefreshPayments = vi.fn();
const mockGenerateReceipt = vi.fn();

vi.mock("../context/StoreContext", () => ({
  useStore: () => ({
    products: [
      { id: "prod_cookies", name: "Cookies", emoji: "🍪", active: true, price: 12, flavor_groups: [], pack_sizes: [] },
    ],
    customers: [],
    orders: [],
    profile: { acceptedMethods: { cash: true, venmo: true } },
    handleCreateCustomer: mockApiCreateOrder,
    apiCreateOrder: mockApiCreateOrder,
    generateReceipt: mockGenerateReceipt,
    refreshPayments: async () => { mockRefreshPayments(); },
  }),
}));

vi.mock("../utils/api", () => ({
  createPayment: (...args: unknown[]) => mockCreatePayment(...args),
  newId: (p: string) => `${p}_test`,
}));

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<OrderModal open onClose={() => {}} />);
  });
  return { text: container.textContent ?? "", container, root };
}

function clickByText(container: HTMLElement, label: string) {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
  expect(btn, `button "${label}"`).toBeTruthy();
  act(() => { btn!.click(); });
}

function setPartialAmount(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="0.00"]');
  expect(input, "partial amount input").toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input!, value); input!.dispatchEvent(new Event("input", { bubbles: true })); });
}

async function addCookies(container: HTMLElement) {
  // Items are added at qty 1 (per-row +/- adjust afterwards), so one click is
  // enough to give the order a $12 total to work against.
  const addBtn = container.querySelector("svg.lucide-plus")?.closest("button") as HTMLButtonElement | null;
  expect(addBtn, "add-item button").toBeTruthy();
  act(() => { addBtn!.click(); });
  await act(async () => {});
}

describe("OrderModal partial payment", () => {
  beforeEach(() => {
    mockApiCreateOrder.mockReset().mockResolvedValue({ id: 101 });
    mockCreatePayment.mockReset().mockResolvedValue({ ok: true });
    mockRefreshPayments.mockReset();
  });

  it("labels the statuses 'Paid in full', 'Partial' and 'Unpaid'", () => {
    const { text } = render();
    expect(text).toContain("Paid in full");
    expect(text).toContain("Partial");
    expect(text).toContain("Unpaid");
  });

  it("reveals the amount-paid field and balance when Partial is chosen", () => {
    const { container, text } = render();
    expect(text).not.toContain("Amount already paid");
    clickByText(container, "Partial");
    expect(container.textContent).toContain("Amount already paid");
    expect(container.textContent).toContain("Balance at pickup");
  });

  it("shows the remaining balance once an amount is entered", async () => {
    const { container } = render();
    await addCookies(container);                 // total $12
    clickByText(container, "Partial");
    expect(container.textContent).toContain("$12.00"); // nothing paid yet → full balance
    setPartialAmount(container, "10");
    expect(container.textContent).toContain("$2.00");  // 12 - 10
  });

  it("blocks submission when Partial has no amount", async () => {
    const { container } = render();
    clickByText(container, "Partial");
    clickByText(container, "Create Order");
    await act(async () => {});
    expect(mockApiCreateOrder).not.toHaveBeenCalled();
  });

  it("blocks submission when the partial amount covers the whole total", async () => {
    const { container } = render();
    clickByText(container, "Partial");
    setPartialAmount(container, "99999");
    clickByText(container, "Create Order");
    await act(async () => {});
    expect(container.textContent).toContain("Paid in full");
    expect(mockApiCreateOrder).not.toHaveBeenCalled();
  });

  it("records the entered partial amount on the payment ledger", async () => {
    const { container } = render();
    await addCookies(container);
    clickByText(container, "Partial");
    setPartialAmount(container, "10");
    clickByText(container, "Create Order");
    await act(async () => {});
    expect(mockApiCreateOrder).toHaveBeenCalledTimes(1);
    expect(mockCreatePayment).toHaveBeenCalledTimes(1);
    const payment = mockCreatePayment.mock.calls[0][0];
    expect(payment.amount).toBe(10);
    expect(payment.orderId).toBe(101);
  });
});
