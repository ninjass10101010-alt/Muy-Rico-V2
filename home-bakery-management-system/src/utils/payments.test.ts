import { describe, it, expect, vi, afterEach } from "vitest";

const fetchMock = vi.fn();

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
