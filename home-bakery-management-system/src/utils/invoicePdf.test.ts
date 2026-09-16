import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument } from "pdf-lib";
import type { Invoice, InvoiceItem } from "../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return Uint8Array.from(buf).buffer as ArrayBuffer;
}

const cormorantBytes = toArrayBuffer(
  fs.readFileSync(path.resolve(__dirname, "../assets/fonts/CormorantGaramond-Regular.ttf"))
);
const quicksandBytes = toArrayBuffer(
  fs.readFileSync(path.resolve(__dirname, "../assets/fonts/Quicksand-Regular.ttf"))
);

vi.mock("../assets/fonts/CormorantGaramond-Regular.ttf", () => ({ default: "/mock/cormorant.ttf" }));
vi.mock("../assets/fonts/Quicksand-Regular.ttf", () => ({ default: "/mock/quicksand.ttf" }));

globalThis.fetch = vi.fn((url: string) => {
  if (url === "/mock/cormorant.ttf") return Promise.resolve(new Response(cormorantBytes));
  if (url === "/mock/quicksand.ttf") return Promise.resolve(new Response(quicksandBytes));
  return Promise.reject(new Error(`Unexpected fetch: ${url}`));
}) as typeof globalThis.fetch;

const invoice: Invoice = {
  id: 7,
  number: "INV-1007",
  status: "sent",
  customerName: "Maria Lopez",
  email: "maria@example.com",
  phone: "555-0100",
  language: "es",
  customerId: null,
  issueDate: "2026-09-16",
  dueDate: "2026-09-30",
  paymentOptions: "both",
  totalCents: 18000,
  notes: "Gracias por su pedido",
  adminNotes: null,
  publicToken: "a".repeat(32),
  paidCents: 0,
  paidAt: null,
  paymentMethod: null,
  convertedOrderId: null,
  items: [],
  createdAt: "2026-09-16 12:00:00",
  updatedAt: "2026-09-16 12:00:00",
};

const items: InvoiceItem[] = [
  { id: 1, description: 'Tres leches 10"', qty: 1, unit_price_cents: 15000, sort_order: 0 },
  { id: 2, description: "Docena de conchas", qty: 1, unit_price_cents: 3000, sort_order: 1 },
];

describe("buildInvoicePdf", () => {
  it("returns well-formed PDF bytes", async () => {
    const { buildInvoicePdf } = await import("./invoicePdf");
    const bytes = await buildInvoicePdf(invoice, items);
    const sig = new TextDecoder().decode(bytes.slice(0, 5));
    expect(sig).toBe("%PDF-");
  });

  it("produces a single Letter page (612×792 pt)", async () => {
    const { buildInvoicePdf } = await import("./invoicePdf");
    const bytes = await buildInvoicePdf(invoice, items);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(612);
    expect(Math.round(height)).toBe(792);
  });

  it("renders an empty invoice without throwing", async () => {
    const { buildInvoicePdf } = await import("./invoicePdf");
    const bytes = await buildInvoicePdf({ ...invoice, items: [], totalCents: 0 }, []);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("paginates a large invoice across multiple Letter pages", async () => {
    const { buildInvoicePdf } = await import("./invoicePdf");
    const many: InvoiceItem[] = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1,
      description: `Custom item number ${i + 1} with a fairly long description`,
      qty: 1,
      unit_price_cents: 1000,
      sort_order: i,
    }));
    const bytes = await buildInvoicePdf({ ...invoice, items: many, totalCents: 40000 }, many);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    for (let i = 0; i < doc.getPageCount(); i++) {
      const { width, height } = doc.getPage(i).getSize();
      expect(Math.round(width)).toBe(612);
      expect(Math.round(height)).toBe(792);
    }
  });
});
