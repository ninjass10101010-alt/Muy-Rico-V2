// Receipt backfill + file export verification.
// Usage: cd home-bakery-management-system && npm run build && npm run preview -- --port 4180
//        node e2e/receipt-visual.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4180";
const OUT = "/tmp/muyrico-receipts";
fs.mkdirSync(OUT, { recursive: true });

const ITEMS_LONG = JSON.stringify(
  Array.from({ length: 14 }, (_, i) => ({
    name: `Producto ${i + 1}`, name_es: `Producto ${i + 1}`, name_en: `Product ${i + 1}`,
    qty: 2, price: 3.5,
  })),
);

// Discount fixture: line items sum to the subtotal (14×2×$3.50 + 1×$5.00 = $103.00),
// which reconciles with subtotal 10300 / discount 500 / total 9800.
const ITEMS_DISCOUNT = JSON.stringify([
  ...JSON.parse(ITEMS_LONG),
  { name: "Decoración extra", name_es: "Decoración extra", name_en: "Extra decoration", qty: 1, price: 5 },
]);

// ~150-character Spanish name repro for the table-clipping blocker, plus a
// ~60-character name in the same list.
const LONG_ITEM_NAME =
  "Tres leches artesanal de vainilla con crema chantilly, fresas frescas de temporada, durazno, rompope casero y canela espolvoreada edición familiar";
const MEDIUM_ITEM_NAME = "Pastel de zanahoria con nuez, pasas y betún de queso crema";
const ITEMS_LONG_NAME = JSON.stringify([
  { name: LONG_ITEM_NAME, name_es: LONG_ITEM_NAME, name_en: LONG_ITEM_NAME, qty: 1, price: 45 },
  { name: MEDIUM_ITEM_NAME, name_es: MEDIUM_ITEM_NAME, name_en: MEDIUM_ITEM_NAME, qty: 2, price: 3.5 },
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `Producto ${i + 3}`, name_es: `Producto ${i + 3}`, name_en: `Product ${i + 3}`,
    qty: 2, price: 3.5,
  })),
]);
const LONG_CUSTOMER = "María Fernanda López-García de la Cruz y Fernández";
const LONG_EMAIL = "maria.fernanda.lopez-garcia@really-long-domain.example.com";

const RECEIPTS = [
  {
    id: "rcpt_13_ghi", orderId: 13, orderNumber: "MR-13", customerName: LONG_CUSTOMER,
    email: LONG_EMAIL, itemsJson: ITEMS_LONG_NAME, totalCents: 13600,
    paymentMethod: "stripe", paymentSubMethod: JSON.stringify({ type: "card", brand: "mastercard", last4: "4444" }),
    orderStatus: "completed", status: "sent", messageId: "msg_3",
    sentAt: "2026-01-04 11:01:00", createdAt: "2026-01-04 11:00:00", language: "es",
  },
  {
    id: "rcpt_7_abc", orderId: 7, orderNumber: "MR-7", customerName: "Ana García",
    email: "ana@example.com", itemsJson: ITEMS_DISCOUNT, totalCents: 9800,
    paymentMethod: "stripe", paymentSubMethod: JSON.stringify({ type: "card", brand: "visa", last4: "4242" }),
    orderStatus: "completed", status: "sent", messageId: "msg_1",
    sentAt: "2026-01-02 10:01:00", createdAt: "2026-01-02 10:00:00", language: "es",
  },
  {
    id: "rcpt_8_def", orderId: 8, orderNumber: "MR-8", customerName: "John Smith",
    email: "john@example.com", itemsJson: ITEMS_LONG, totalCents: 4500,
    paymentMethod: "cash", paymentSubMethod: null,
    orderStatus: "pending", status: "printed", messageId: null,
    sentAt: "2026-01-03 09:00:00", createdAt: "2026-01-03 09:00:00", language: "en",
  },
];

const ORDER_7 = {
  id: 7, created_at: "2026-01-02 10:00:00", customer_name: "Ana García", customer_id: null,
  phone: "616-555-0100", pickup_date: "2026-01-05", pickup_time: "10:00", items_json: ITEMS_DISCOUNT,
  total_cents: 9800, subtotal_cents: 10300, discount_cents: 500, payment_method: "stripe",
  payment_sub_method: JSON.stringify({ type: "card", brand: "visa", last4: "4242" }),
  payment_status: "paid", status: "completed", notes: "Sin canela por favor", created_by: "jeff",
  source: "website", food_coloring: null, email: "ana@example.com", language: "es",
};
const ORDER_8 = {
  ...ORDER_7, id: 8, customer_name: "John Smith", payment_method: "cash",
  payment_sub_method: null, payment_status: "unpaid", items_json: ITEMS_LONG, notes: null,
  email: "john@example.com", language: "en", subtotal_cents: 9800, discount_cents: 0,
};
const ORDER_13 = {
  id: 13, created_at: "2026-01-04 11:00:00", customer_name: LONG_CUSTOMER, customer_id: null,
  phone: "616-555-0130", pickup_date: "2026-01-06", pickup_time: "12:00", items_json: ITEMS_LONG_NAME,
  total_cents: 13600, subtotal_cents: 13600, discount_cents: 0, payment_method: "stripe",
  payment_sub_method: JSON.stringify({ type: "card", brand: "mastercard", last4: "4444" }),
  payment_status: "paid", status: "completed", notes: null, created_by: "jeff",
  source: "website", food_coloring: null, email: LONG_EMAIL, language: "es",
};

const MISSING = {
  orders: [
    { id: 11, customer_name: "María López", email: "maria@example.com", phone: null, created_at: "2025-12-01 10:00:00", pickup_date: "2025-12-05", payment_status: "paid", status: "completed", total_cents: 5600, language: "es", receipt_attempts: 0, last_receipt_status: null, last_receipt_at: null },
    { id: 12, customer_name: "Jane Doe", email: "jane@example.com", phone: null, created_at: "2025-12-02 10:00:00", pickup_date: "2025-12-06", payment_status: "paid", status: "completed", total_cents: 3200, language: "en", receipt_attempts: 1, last_receipt_status: "failed", last_receipt_at: "2025-12-02 10:01:00" },
    { id: 21, customer_name: LONG_CUSTOMER, email: LONG_EMAIL, phone: null, created_at: "2025-12-03 10:00:00", pickup_date: "2025-12-07", payment_status: "paid", status: "completed", total_cents: 13600, language: "es", receipt_attempts: 0, last_receipt_status: null, last_receipt_at: null },
  ],
};

const JSON_HEADERS = { "content-type": "application/json" };

async function mockApi(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    const respond = (body) => route.fulfill({ status: 200, headers: JSON_HEADERS, body: JSON.stringify(body) });
    if (path === "/api/auth/verify") return respond({ email: "owner@muy-rico.com" });
    if (path === "/api/auth/device-token") return respond({ token: "test-token" });
    if (path === "/api/receipts") return respond({ receipts: RECEIPTS });
    if (path === "/api/orders/missing-receipts") return respond(MISSING);
    if (path === "/api/orders/send-receipts") {
      const body = JSON.parse(route.request().postData() || "{}");
      return respond({ results: (body.ids || []).map((id) => ({ id, ok: true, status: "sent", messageId: "m" })), sent: (body.ids || []).length, failed: 0, skipped: 0 });
    }
    if (path === "/api/orders/7") return respond({ order: ORDER_7, events: [] });
    if (path === "/api/orders/8") return respond({ order: ORDER_8, events: [] });
    if (path === "/api/orders/13") return respond({ order: ORDER_13, events: [] });
    if (path === "/api/orders") return respond({ orders: [ORDER_13, ORDER_7, ORDER_8] });
    if (path === "/api/products" || path === "/api/inventory" || path === "/api/customers" || path === "/api/payments" || path === "/api/quotes" || path === "/api/invoices") return respond([]);
    if (path === "/api/inventory/groups") return respond([]);
    if (path === "/api/labels") return respond([]);
    if (path === "/api/profile") return respond({});
    return respond({});
  });
}

async function main() {
  const browser = await chromium.launch();
  const consoleErrors = [];
  for (const view of [
    { id: "mobile", vp: { width: 390, height: 844 } },
    { id: "desktop", vp: { width: 1280, height: 900 } },
  ]) {
    const ctx = await browser.newContext({ viewport: view.vp, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => consoleErrors.push(`${view.id} pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${view.id} console: ${m.text()}`); });
    await page.addInitScript(() => {
      try { localStorage.setItem("muyrico.deviceToken", "test-token"); } catch {}
    });
    await mockApi(page);
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    // Open Receipts (mobile needs the menu first)
    if (view.id === "mobile") {
      await page.locator("button:visible:has(.lucide-menu)").first().click();
    }
    await page.locator("button:visible", { hasText: /^Receipts$/ }).first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/${view.id}-history.png`, fullPage: true });

    // Missing tab
    await page.getByText(/Missing receipts/).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${view.id}-missing.png`, fullPage: true });
    const checkboxes = page.locator('input[type="checkbox"]');
    if (await checkboxes.count() > 1) await checkboxes.nth(1).check();
    await page.screenshot({ path: `${OUT}/${view.id}-missing-selected.png`, fullPage: true });

    // File actions (history tab)
    await page.getByText("History", { exact: true }).click();
    await page.waitForTimeout(400);
    for (const label of ["PDF", "PNG"]) {
      const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
      await page.locator("button:visible", { hasText: label }).first().click();
      const download = await downloadPromise;
      await download.saveAs(`${OUT}/${view.id}-${download.suggestedFilename()}`);
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(`${OUT}/console.log`, consoleErrors.join("\n"));
  console.log(consoleErrors.length ? `CONSOLE ERRORS:\n${consoleErrors.join("\n")}` : "console clean");
  console.log("artifacts in " + OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
