import { describe, it, expect } from "vitest";
import { formatPaymentSubMethod, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLORS } from "./format";

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
