import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Order, Payment } from "../types";
import type { PaymentOutcome } from "./api";
import Orders from "../pages/Orders";

const fetchMock = vi.fn();

// React only flushes effects inside act() when the environment opts in.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function stubFetchOnce(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
}

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

/**
 * The conversion from the cents the dashboard does its balance maths in to the
 * dollars the wire carries is the step that silently over-collects when it is
 * wrong, so it is pinned here rather than only inside a React callback.
 */
describe("buildPaymentCreate", () => {
  it("sends amount in dollars, converting from cents exactly once", async () => {
    const { buildPaymentCreate } = await import("./api");
    const body = buildPaymentCreate(
      {
        id: "p1",
        orderId: 1,
        customerName: "Ana",
        amountCents: 3050,
        method: "cash",
      },
    );
    expect(body.amount).toBe(30.5);
  });

  it("keeps customerName, which the server 400s without", async () => {
    const { buildPaymentCreate } = await import("./api");
    const body = buildPaymentCreate(
      {
        id: "p1",
        orderId: 1,
        customerName: "Ana",
        amountCents: 3050,
        method: "cash",
      },
    );
    expect(body.customerName).toBe("Ana");
  });

  it("carries replace: false so a deposit survives the balance that settles it", async () => {
    const { buildPaymentCreate } = await import("./api");
    const body = buildPaymentCreate(
      {
        id: "p1",
        orderId: 1,
        customerName: "Ana",
        amountCents: 1300,
        method: "cash",
        replace: false,
      },
    );
    expect(body.replace).toBe(false);
  });

  it("omits replace entirely when unset, leaving the server default of true", async () => {
    const { buildPaymentCreate } = await import("./api");
    const body = buildPaymentCreate({
      id: "p1",
      orderId: 1,
      customerName: "Ana",
      amountCents: 1300,
      method: "cash",
    });
    // The wire is what the server reads: an undefined key must not serialize.
    expect("replace" in JSON.parse(JSON.stringify(body))).toBe(false);
  });

  it("maps subMethod onto methodDetails and nulls it when absent", async () => {
    const { buildPaymentCreate } = await import("./api");
    const base = { id: "p1", orderId: 1, customerName: "Ana", amountCents: 100, method: "cash" as const };
    expect(buildPaymentCreate({ ...base, subMethod: "in the jar" }).methodDetails).toBe("in the jar");
    expect(buildPaymentCreate(base).methodDetails).toBeNull();
  });
});

/**
 * OrderModal records the new-order deposit by calling createPayment directly
 * with DOLLARS, so createPayment must not convert anything itself.
 */
describe("createPayment wire format", () => {
  it("sends amount in dollars verbatim for the OrderModal deposit path", async () => {
    stubFetchOnce({ ok: true, id: "p1", paymentStatus: "partial", balanceCents: 11700 });
    const { createPayment } = await import("./api");
    await createPayment({
      id: "p1",
      orderId: 1,
      customerName: "Ana",
      amount: 1.3,
      method: "cash",
    });
    // Without the count, a token refresh or a retry added ahead of this call
    // would make mock.calls[0] a different request and the assertion vacuous.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody().amount).toBe(1.3);
  });

  it("forwards replace to the server", async () => {
    stubFetchOnce({ ok: true, id: "p1", paymentStatus: "paid", balanceCents: 0 });
    const { createPayment } = await import("./api");
    await createPayment({
      id: "p1",
      orderId: 1,
      customerName: "Ana",
      amount: 13,
      method: "cash",
      replace: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody().replace).toBe(false);
  });
});

/**
 * The server omits paymentStatus and balanceCents when the order vanished
 * mid-flight or a post-commit step failed, so that "nothing is due" stays
 * distinguishable from "we could not determine this". Reading absent as zero
 * would re-fabricate exactly the lie the server avoided.
 */
describe("readPaymentResult", () => {
  it("reports the derived status and balance when the server reports both", async () => {
    const { readPaymentResult } = await import("./api");
    expect(readPaymentResult({ ok: true, paymentStatus: "partial", balanceCents: 3000 })).toEqual({
      ok: true,
      paymentStatus: "partial",
      balanceCents: 3000,
      determined: true,
    });
  });

  it("keeps a genuine zero balance as a determined result", async () => {
    const { readPaymentResult } = await import("./api");
    expect(readPaymentResult({ ok: true, paymentStatus: "paid", balanceCents: 0 })).toEqual({
      ok: true,
      paymentStatus: "paid",
      balanceCents: 0,
      determined: true,
    });
  });

  it("does not fabricate unpaid and zero when the server omits both fields", async () => {
    const { readPaymentResult } = await import("./api");
    expect(readPaymentResult({ ok: true })).toEqual({
      ok: true,
      paymentStatus: null,
      balanceCents: null,
      determined: false,
    });
  });

  it("stays undetermined when only one of the two fields came back", async () => {
    const { readPaymentResult } = await import("./api");
    expect(readPaymentResult({ ok: true, paymentStatus: "partial" }).determined).toBe(false);
    expect(readPaymentResult({ ok: true, balanceCents: 0 }).determined).toBe(false);
  });

  it("stays undetermined when the request itself produced no result", async () => {
    const { readPaymentResult } = await import("./api");
    expect(readPaymentResult(null)).toEqual({
      ok: false,
      paymentStatus: null,
      balanceCents: null,
      determined: false,
    });
  });
});

const ORDER_52: Order = {
  id: "52",
  orderNumber: "MR-52",
  customerId: null,
  customerName: "Ana",
  phone: "",
  items: [{ productId: "p1", name: "Cake", qty: 1, price: 13, emoji: "🎂" }],
  source: "in-person",
  status: "pending",
  pickupDate: "2026-10-01",
  dueDate: "2026-10-01",
  subtotal: 13,
  discount: 0,
  total: 13,
  paymentStatus: "partial",
  paymentMethod: "cash",
  paymentSubMethod: null,
  inventoryDeducted: false,
  notes: "",
  foodColoring: "",
  createdAt: "2026-09-01T00:00:00.000Z",
} as unknown as Order;

/** The $1.30 deposit OrderModal records, already committed on the server. */
const DEPOSIT: Payment = {
  id: "p1",
  orderId: "52",
  orderNumber: "MR-52",
  customerName: "Ana",
  amount: 1.3,
  method: "cash",
  date: "2026-09-01T00:00:00.000Z",
} as unknown as Payment;

/**
 * The cents owed is the number that gets charged, so it is pinned separately
 * from the React handler that consumes it.
 */
describe("remaining balance", () => {
  it("subtracts the deposit already collected, in cents", async () => {
    const { paidCentsForOrder, remainingBalanceCents } = await import("./api");
    expect(paidCentsForOrder([DEPOSIT], "52")).toBe(130);
    // Order 52: $13.00 total, $1.30 deposit → charge the $11.70 remainder.
    expect(await remainingBalanceCents(async () => [DEPOSIT], "52", 1300)).toBe(1170);
  });

  it("ignores payments belonging to other orders", async () => {
    const { remainingBalanceCents } = await import("./api");
    const other = { ...DEPOSIT, orderId: "51" } as Payment;
    expect(await remainingBalanceCents(async () => [other, DEPOSIT], "52", 1300)).toBe(1170);
  });

  it("never returns a negative balance on an over-collected order", async () => {
    const { remainingBalanceCents } = await import("./api");
    const rows = [DEPOSIT, { ...DEPOSIT, id: "p2", amount: 13 }];
    expect(await remainingBalanceCents(async () => rows, "52", 1300)).toBe(0);
  });

  it("totals the REAL column's floats to the cent", async () => {
    const { paidCentsForOrder } = await import("./api");
    expect(paidCentsForOrder([{ ...DEPOSIT, amount: 0.1 }, { ...DEPOSIT, id: "p2", amount: 0.2 }], "52")).toBe(30);
  });
});

/**
 * The Collect Balance handler is the reason this task exists: OrderModal
 * records the deposit only AFTER handleApiCreateOrder's refresh has already
 * run, so the `payments` array on screen is missing it. These tests drive the
 * real page with a store whose `payments` array is stale and whose
 * `refreshPayments` is not, so a handler that reads the render-time array
 * charges the full $13.00 and fails.
 */
const h = vi.hoisted(() => ({ store: null as FakeStore | null }));
vi.mock("../context/StoreContext", () => ({ useStore: () => h.store }));

function makeStore(recordPayment: (input: Record<string, unknown>) => Promise<PaymentOutcome>) {
  return {
    orders: [ORDER_52],
    products: [],
    // Stale on purpose: the deposit is committed on the server but this array
    // has not been re-read since the order was created.
    payments: [] as Payment[],
    customers: [],
    receipts: [],
    profile: { acceptedMethods: { cash: true, card: true } },
    apiDeductInventory: vi.fn(async () => {}),
    apiUpdateOrder: vi.fn(async () => {}),
    apiDeleteOrder: vi.fn(async () => {}),
    handleRelinkOrder: vi.fn(async () => {}),
    refreshLabelTemplates: vi.fn(async () => {}),
    resendReceipt: vi.fn(async () => {}),
    generateReceipt: vi.fn(async () => {}),
    refreshOrders: vi.fn(async () => [ORDER_52]),
    refreshPayments: vi.fn(async () => [DEPOSIT]),
    recordPayment: vi.fn(recordPayment),
  };
}

type FakeStore = ReturnType<typeof makeStore>;

const determined: PaymentOutcome = { ok: true, paymentStatus: "paid", balanceCents: 0, determined: true };

function buttonByText(root: ParentNode, re: RegExp): HTMLButtonElement {
  const found = Array.from(root.querySelectorAll("button")).find((b) => re.test((b.textContent || "").trim()));
  if (!found) throw new Error(`no button matching ${re}`);
  return found;
}

/**
 * Text of the open order modal only. The page-level banner is a sibling in the
 * same container, so an assertion over the whole container would pass even when
 * the message is stranded behind the modal's blurred backdrop.
 */
function modalText(container: HTMLElement): string {
  const modal = container.querySelector("h3")?.closest(".fixed");
  if (!modal) throw new Error("the order modal is not open");
  return modal.textContent || "";
}

const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

// Unmounting is itself a state update on the root, so it goes inside act.
const teardown = (root: Root, container: HTMLElement) =>
  act(() => {
    root.unmount();
    container.remove();
  });

/** Renders Orders, opens order 52, and opens the Collect Balance panel. */
async function openCollectBalance(store: FakeStore) {
  h.store = store;
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ events: [] }) })));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(Orders, { search: "", setPage: () => {}, setLabelFilter: () => {} }));
  });
  await click(container.querySelector("tbody tr") as Element);
  await click(buttonByText(container, /^Collect Balance$/));
  return { container, root };
}

describe("Collect Balance (rendered page)", () => {
  it("charges the remainder left after the deposit, read fresh", async () => {
    const store = makeStore(async () => determined);
    const { container, root } = await openCollectBalance(store);

    await click(buttonByText(container, /^Collect Balance$/));

    expect(store.recordPayment).toHaveBeenCalledTimes(1);
    expect(store.recordPayment.mock.calls[0][0].amountCents).toBe(1170);
    expect(store.recordPayment.mock.calls[0][0].replace).toBe(false);
    expect(store.refreshPayments, "the balance must come from a fresh read").toHaveBeenCalled();
    expect(store.generateReceipt).toHaveBeenCalledTimes(1);
    teardown(root, container);
  });

  it("keeps the ledger's order number on the payment", async () => {
    const store = makeStore(async () => determined);
    const { container, root } = await openCollectBalance(store);

    await click(buttonByText(container, /^Collect Balance$/));

    expect(store.recordPayment.mock.calls[0][0].orderNumber).toBe("MR-52");
    teardown(root, container);
  });

  it("disables the button while the collection is in flight, so a double click cannot collect twice", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const store = makeStore(async () => { await gate; return determined; });
    const { container, root } = await openCollectBalance(store);

    await click(buttonByText(container, /^Collect Balance$/));
    const busy = buttonByText(container, /^Collect/);
    expect(busy.disabled, "replace:false appends, so the button must not stay live").toBe(true);
    await click(busy);
    expect(store.recordPayment).toHaveBeenCalledTimes(1);

    await act(async () => { release(); });
    expect(store.recordPayment).toHaveBeenCalledTimes(1);
    teardown(root, container);
  });

  it("shows a failed post inside the modal, and claims no receipt", async () => {
    const store = makeStore(async () => {
      throw new Error("network down");
    });
    const { container, root } = await openCollectBalance(store);

    await click(buttonByText(container, /^Collect Balance$/));

    // The page-level banner renders behind the modal's blurred backdrop, so the
    // message has to be inside the modal to be seen at all.
    expect(modalText(container)).toContain("Could not confirm the payment.");
    expect(store.generateReceipt).not.toHaveBeenCalled();
    expect(store.recordPayment).toHaveBeenCalledTimes(1);
    teardown(root, container);
  });

  it("claims no receipt when the server could not determine the balance", async () => {
    const store = makeStore(async () => ({
      ok: true,
      paymentStatus: null,
      balanceCents: null,
      determined: false,
    }));
    const { container, root } = await openCollectBalance(store);

    await click(buttonByText(container, /^Collect Balance$/));

    expect(store.generateReceipt).not.toHaveBeenCalled();
    expect(modalText(container)).toContain("could not be confirmed");
    // The panel collapses so there is no live button next to an unverified
    // collection, but the modal stays open with the message on it.
    expect(modalText(container)).toContain("Order MR-52");
    expect(buttonByText(container, /Collect/).disabled).toBe(false);
    teardown(root, container);
  });
});
