import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import Payments from "./Payments";
import { useStore } from "../context/StoreContext";
import type { Order, Payment } from "../types";
import type { ApiPayment } from "../utils/api";

vi.mock("../context/StoreContext", () => ({ useStore: vi.fn() }));
vi.mock("../utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/api")>();
  return { ...actual, fetchPayments: vi.fn(), restorePayment: vi.fn() };
});

import { fetchPayments, restorePayment } from "../utils/api";

const mockedUseStore = useStore as unknown as ReturnType<typeof vi.fn>;
const mockedFetchPayments = fetchPayments as unknown as ReturnType<typeof vi.fn>;
const mockedRestorePayment = restorePayment as unknown as ReturnType<typeof vi.fn>;

// React only flushes effects inside act() when the environment opts in.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORDER_39 = {
  id: "39",
  orderNumber: "MR-39",
  customerId: null,
  customerName: "Ana",
  phone: "",
  items: [],
  source: "in-person",
  status: "completed",
  subtotal: 40,
  discount: 0,
  total: 40,
  paymentStatus: "paid",
  paymentMethod: "cash",
  paymentSubMethod: null,
  inventoryDeducted: false,
  notes: "",
  foodColoring: "",
  createdAt: "2026-09-01T00:00:00.000Z",
} as unknown as Order;

const row = (partial: Partial<ApiPayment>): ApiPayment => ({
  id: "p1",
  orderId: 39,
  orderNumber: "MR-39",
  customerName: "Ana",
  amount: 40,
  method: "cash",
  methodDetails: null,
  date: "2026-09-01T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  active: true,
  ...partial,
});

function render(overrides: {
  payments?: Payment[];
  orders?: Order[];
  allRows?: ApiPayment[];
}) {
  const refreshPayments = vi.fn(async () => [] as Payment[]);
  const refreshOrders = vi.fn(async () => [] as Order[]);
  mockedUseStore.mockImplementation(() => ({
    payments: overrides.payments ?? [],
    orders: overrides.orders ?? [ORDER_39],
    profile: { acceptedMethods: { cash: true, venmo: true } },
    refreshPayments,
    refreshOrders,
  }));
  mockedFetchPayments.mockResolvedValue(overrides.allRows ?? []);
  mockedRestorePayment.mockResolvedValue({ ok: true });

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Payments search="" />);
  });

  return {
    container,
    refreshPayments,
    refreshOrders,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

function buttonByText(root: ParentNode, re: RegExp): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) =>
    re.test((b.textContent || "").trim()),
  );
  if (!found) throw new Error(`no button matching ${re}`);
  return found as HTMLButtonElement;
}

/** The voided-payments disclosure, opened. */
async function openVoided(container: HTMLElement) {
  await click(buttonByText(container, /Voided payments/));
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("voided payments table", () => {
  it("names the order each voided row belongs to", async () => {
    // Four voided $40 rows on order 39 all read "Ana / cash / $40.00": with no
    // Order column the owner cannot tell which order a Restore click puts
    // money back onto.
    const { container, unmount } = render({
      allRows: [
        row({ id: "p_void", active: false }),
        row({ id: "p_active", amount: 40, active: true }),
      ],
    });
    await openVoided(container);

    const voided = buttonByText(container, /Voided payments/).parentElement as HTMLElement;
    const headers = Array.from(voided.querySelectorAll("th")).map((th) => th.textContent?.trim());
    expect(headers).toContain("Order");
    expect(voided.textContent).toContain("MR-39");
    unmount();
  });
});

describe("restoring a voided payment", () => {
  const overCollectedRows = [
    row({ id: "p_void", active: false }),
    row({ id: "p_active", amount: 40, active: true }),
  ];

  it("asks first when the restore would push the order past its total", async () => {
    const confirm = vi.fn((_: string) => false);
    vi.stubGlobal("confirm", confirm);

    const { container, unmount } = render({ allRows: overCollectedRows });
    await openVoided(container);
    await click(buttonByText(container, /^Restore$/));

    expect(confirm).toHaveBeenCalledTimes(1);
    // $40.00 already active + $40.00 restored = $80.00 against a $40.00 order.
    const message = String(confirm.mock.calls[0][0]);
    expect(message).toContain("$40.00 already active");
    expect(message).toContain("$40.00 restored");
    expect(message).toContain("$80.00");
    expect(message).toContain("$40.00 order");
    expect(mockedRestorePayment, "a dismissed warning must not restore").not.toHaveBeenCalled();
    unmount();
  });

  it("restores when the owner confirms the arithmetic", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));

    const { container, unmount } = render({ allRows: overCollectedRows });
    await openVoided(container);
    await click(buttonByText(container, /^Restore$/));

    expect(mockedRestorePayment).toHaveBeenCalledWith("p_void");
    unmount();
  });

  it("does not ask when the restore stays within the order total", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);

    const { container, unmount } = render({
      orders: [{ ...ORDER_39, total: 100 } as Order],
      allRows: overCollectedRows,
    });
    await openVoided(container);
    await click(buttonByText(container, /^Restore$/));

    expect(confirm).not.toHaveBeenCalled();
    expect(mockedRestorePayment).toHaveBeenCalledWith("p_void");
    unmount();
  });

  it("restores without asking when the order total cannot be read", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);

    const { container, unmount } = render({ orders: [], allRows: overCollectedRows });
    await openVoided(container);
    await click(buttonByText(container, /^Restore$/));

    expect(confirm, "a missing order must not block the ledger").not.toHaveBeenCalled();
    expect(mockedRestorePayment).toHaveBeenCalledWith("p_void");
    unmount();
  });

  it("restores without asking when the order's total is not a number", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);

    const { container, unmount } = render({
      orders: [{ ...ORDER_39, total: undefined } as unknown as Order],
      allRows: overCollectedRows,
    });
    await openVoided(container);
    await click(buttonByText(container, /^Restore$/));

    expect(confirm).not.toHaveBeenCalled();
    expect(mockedRestorePayment).toHaveBeenCalledWith("p_void");
    unmount();
  });
});

describe("after a restore", () => {
  it("refreshes the orders, whose payment_status the server just re-derived", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    const { container, refreshOrders, unmount } = render({
      allRows: [row({ id: "p_void", active: false })],
    });
    await openVoided(container);
    await click(buttonByText(container, /^Restore$/));

    expect(refreshOrders).toHaveBeenCalled();
    unmount();
  });
});
