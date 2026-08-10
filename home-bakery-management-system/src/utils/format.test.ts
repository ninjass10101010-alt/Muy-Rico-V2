import { describe, it, expect } from "vitest";
import { formatPaymentSubMethod, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLORS, dueTier, urgencyRank } from "./format";

describe("PAYMENT_METHOD_LABELS", () => {
  it("includes paypal", () => {
    expect(PAYMENT_METHOD_LABELS.paypal).toBe("PayPal");
  });
});

describe("PAYMENT_METHOD_COLORS", () => {
  it("includes paypal", () => {
    expect(PAYMENT_METHOD_COLORS.paypal).toBe("#0070BA");
  });
});

describe("formatPaymentSubMethod", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(formatPaymentSubMethod(null)).toBe("");
    expect(formatPaymentSubMethod(undefined)).toBe("");
    expect(formatPaymentSubMethod("")).toBe("");
  });

  it("returns empty string for invalid JSON", () => {
    expect(formatPaymentSubMethod("not-json")).toBe("");
  });

  it("formats Stripe card with last4", () => {
    const json = JSON.stringify({ type: "card", brand: "visa", funding: "credit", last4: "4242" });
    expect(formatPaymentSubMethod(json)).toBe("Visa Credit (…4242)");
  });

  it("formats Stripe card without last4", () => {
    const json = JSON.stringify({ type: "card", brand: "mastercard", funding: "debit" });
    expect(formatPaymentSubMethod(json)).toBe("Mastercard Debit");
  });

  it("formats PayPal wallet", () => {
    const json = JSON.stringify({ type: "paypal_wallet" });
    expect(formatPaymentSubMethod(json)).toBe("PayPal Wallet");
  });

  it("formats PayPal card (uppercase brand/funding)", () => {
    const json = JSON.stringify({ type: "card", brand: "VISA", funding: "CREDIT" });
    expect(formatPaymentSubMethod(json)).toBe("Visa Credit");
  });

  it("formats unknown card brand", () => {
    const json = JSON.stringify({ type: "card", brand: "unknown", funding: "unknown" });
    expect(formatPaymentSubMethod(json)).toBe("Card");
  });

  it("formats link type", () => {
    const json = JSON.stringify({ type: "link" });
    expect(formatPaymentSubMethod(json)).toBe("Link");
  });

  it("capitalizes brand and funding", () => {
    const json = JSON.stringify({ type: "card", brand: "AMEX", funding: "CREDIT", last4: "0001" });
    expect(formatPaymentSubMethod(json)).toBe("Amex Credit (…0001)");
  });
});

describe("dueTier", () => {
  const iso = (d: Date) => d.toISOString();

  it("marks completed/cancelled orders inactive", () => {
    expect(dueTier("2020-01-01", "completed")).toBe("inactive");
    expect(dueTier("2020-01-01", "cancelled")).toBe("inactive");
  });

  it("marks past due dates overdue", () => {
    const past = new Date();
    past.setDate(past.getDate() - 1);
    expect(dueTier(iso(past))).toBe("overdue");
  });

  it("marks today as today", () => {
    expect(dueTier(iso(new Date()))).toBe("today");
  });

  it("marks tomorrow as tomorrow", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(dueTier(iso(tomorrow))).toBe("tomorrow");
  });

  it("marks 3 days out as this-week", () => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    expect(dueTier(iso(d))).toBe("this-week");
  });

  it("marks 8 days out as future", () => {
    const d = new Date();
    d.setDate(d.getDate() + 8);
    expect(dueTier(iso(d))).toBe("future");
  });

  it("falls back to future for missing/invalid dates", () => {
    expect(dueTier("")).toBe("future");
    expect(dueTier("not-a-date")).toBe("future");
  });
});

describe("urgencyRank", () => {
  const base = { dueDate: new Date().toISOString(), status: "pending", paymentStatus: "unpaid" };

  it("ranks overdue unpaid most urgent", () => {
    const overdue = { ...base, dueDate: new Date(Date.now() - 86_400_000).toISOString() };
    expect(urgencyRank(overdue)).toBeLessThan(urgencyRank(base));
  });

  it("ranks unpaid above paid at same due tier", () => {
    const paid = { ...base, paymentStatus: "paid" };
    expect(urgencyRank(base)).toBeLessThan(urgencyRank(paid));
  });

  it("ranks partial above paid at same due tier", () => {
    const partial = { ...base, paymentStatus: "partial" };
    const paid = { ...base, paymentStatus: "paid" };
    expect(urgencyRank(partial)).toBeLessThan(urgencyRank(paid));
  });

  it("sinks completed/cancelled to the bottom", () => {
    const done = { ...base, status: "completed" };
    const cancelled = { ...base, status: "cancelled" };
    expect(urgencyRank(done)).toBeGreaterThan(urgencyRank(base));
    expect(urgencyRank(cancelled)).toBeGreaterThan(urgencyRank(base));
  });
});
