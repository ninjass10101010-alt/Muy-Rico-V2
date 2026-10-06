import { describe, it, expect } from "vitest";
import { buildReceiptViewModel } from "./receiptView";
import type { ReceiptViewInput, ReceiptViewOrder } from "./receiptView";

const RECEIPT: ReceiptViewInput = {
  receiptId: "rcpt_7_abc",
  orderId: 7,
  orderNumber: "MR-7",
  customerName: "Ana",
  itemsJson: JSON.stringify([{ name: "Concha", name_es: "Concha", name_en: "Sweet Bread", qty: 2, price: 2.5 }]),
  totalCents: 500,
  paymentMethod: "stripe",
  paymentSubMethod: JSON.stringify({ type: "card", brand: "visa", last4: "4242" }),
  orderStatus: "completed",
  language: "es",
  createdAt: "2026-01-02 10:00:00",
};

const ORDER: ReceiptViewOrder = {
  id: 7,
  customer_name: "Ana",
  items_json: JSON.stringify([{ name: "Concha", name_es: "Concha", name_en: "Sweet Bread", qty: 2, price: 2.5 }]),
  total_cents: 500,
  subtotal_cents: 600,
  discount_cents: 100,
  payment_method: "stripe",
  payment_sub_method: JSON.stringify({ type: "card", brand: "visa", last4: "4242" }),
  status: "completed",
  payment_status: "paid",
  pickup_date: "2026-01-05",
  pickup_time: "10:00",
  created_at: "2026-01-02 10:00:00",
  notes: "Sin canela",
  language: "es",
};

describe("buildReceiptViewModel", () => {
  it("uses the live order when present and the snapshot otherwise", () => {
    const live = buildReceiptViewModel(RECEIPT, ORDER, "es");
    expect(live.pickupDate).toBe("2026-01-05");
    expect(live.notes).toBe("Sin canela");
    expect(live.discountCents).toBe(100);
    expect(live.subtotalCents).toBe(600);

    const snapshot = buildReceiptViewModel(RECEIPT, null, "es");
    expect(snapshot.pickupDate).toBeNull();
    expect(snapshot.paymentStatus).toBe("paid");
    expect(snapshot.totalCents).toBe(500);
  });

  it("picks item names by language and formats card labels", () => {
    const es = buildReceiptViewModel(RECEIPT, ORDER, "es");
    expect(es.items[0].name).toBe("Concha");
    expect(es.paymentLabel).toBe("Visa (…4242)");
    expect(es.labels.order).toBe("Pedido");
    const en = buildReceiptViewModel(RECEIPT, ORDER, "en");
    expect(en.items[0].name).toBe("Sweet Bread");
    expect(en.labels.order).toBe("Order");
    expect(en.labels.receipt).toBe("RECEIPT");
    expect(en.labels.total).toBe("TOTAL PAID");
    expect(en.labels.footer).toBe("Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor");
  });

  it("renders invoice wording for unpaid and partial orders", () => {
    const unpaid = buildReceiptViewModel(RECEIPT, { ...ORDER, payment_status: "unpaid" }, "en");
    expect(unpaid.labels.receipt).toBe("INVOICE");
    expect(unpaid.labels.total).toBe("TOTAL DUE");
    expect(unpaid.labels.paidNote).toBe("Your order is confirmed. Payment is due at pickup.");
    const partial = buildReceiptViewModel(RECEIPT, { ...ORDER, payment_status: "partial" }, "es");
    expect(partial.labels.receipt).toBe("FACTURA");
    expect(partial.labels.total).toBe("TOTAL");
    expect(partial.labels.paidNote).toBe("Tu pedido está confirmado. Depósito recibido — el saldo se paga al recoger.");
  });

  it("renders invoice wording for unknown payment status but keeps snapshots as receipts", () => {
    const refunded = buildReceiptViewModel(RECEIPT, { ...ORDER, payment_status: "refunded" }, "en");
    expect(refunded.labels.receipt).toBe("INVOICE");
    expect(refunded.labels.total).toBe("TOTAL DUE");
    const snapshot = buildReceiptViewModel(RECEIPT, null, "en");
    expect(snapshot.labels.receipt).toBe("RECEIPT");
  });

  it("gates a stale card sub-method on cash and survives broken items JSON", () => {
    const stale = buildReceiptViewModel(RECEIPT, { ...ORDER, payment_method: "cash" }, "en");
    expect(stale.paymentLabel).toBe("Cash");
    const broken = buildReceiptViewModel({ ...RECEIPT, itemsJson: "not json" }, null, "en");
    expect(broken.items).toEqual([]);
    expect(broken.rawItemsText).toBe("not json");
  });
});
