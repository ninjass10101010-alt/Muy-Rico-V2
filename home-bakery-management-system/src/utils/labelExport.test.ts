import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { LabelTemplate, BusinessProfile } from "../types";
import { DEFAULT_REMINDER_CONFIG } from "../types";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const cormorantBytes = toArrayBuffer(
  fs.readFileSync(path.resolve(__dirname, "../assets/fonts/CormorantGaramond-Regular.ttf")),
);
const quicksandBytes = toArrayBuffer(
  fs.readFileSync(path.resolve(__dirname, "../assets/fonts/Quicksand-Regular.ttf")),
);

vi.mock("../assets/fonts/CormorantGaramond-Regular.ttf", () => ({ default: "/mock/cormorant.ttf" }));
vi.mock("../assets/fonts/Quicksand-Regular.ttf", () => ({ default: "/mock/quicksand.ttf" }));

const mockFetch = vi.fn((url: string) => {
  if (url === "/mock/cormorant.ttf") {
    return Promise.resolve(new Response(cormorantBytes));
  }
  if (url === "/mock/quicksand.ttf") {
    return Promise.resolve(new Response(quicksandBytes));
  }
  return Promise.reject(new Error(`Unexpected fetch: ${url}`));
});
globalThis.fetch = mockFetch as typeof globalThis.fetch;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLabel(overrides: Partial<LabelTemplate> = {}): LabelTemplate {
  return {
    id: "test-label",
    name: "Test",
    shape: "rounded",
    bgColor: "#FBF3E7",
    accentColor: "#C17A3F",
    textColor: "#4A3222",
    businessName: "Muy Rico",
    productName: "Test Product",
    details: "A test label",
    ingredients: "Flour, sugar, butter",
    allergens: "Contains: wheat, milk.",
    netWeight: "8 oz",
    price: "$5.00",
    showPrice: true,
    showBestBy: true,
    bestByDays: 7,
    logoEmoji: "\uD83E\uDDC1",
    logoImage: null,
    logoSize: 16,
    font: "'Cormorant Garamond', Georgia, serif",
    businessIdMode: "registration",
    address: "",
    phoneNumber: "555-0100",
    registrationNumber: "MI-12345",
    showDisclaimer: true,
    labelWidth: 3,
    labelHeight: 4,
    displayOrder: 0,
    elements: null,
    websiteUrl: "https://muy-rico.com",
    orientation: "portrait",
    disclaimerVariant: "standard",
    productType: "standard",
    netWeightUS: "8 oz",
    netWeightMetric: "226 g",
    allergenTags: ["Wheat", "Milk"],
    noAllergensConfirmed: false,
    nutrientClaim: false,
    bgImage: null,
    averyPreset: "single",
    ...overrides,
  };
}

const profile: BusinessProfile = {
  name: "Muy Rico",
  phone: "555-0100",
  registrationNumber: "MI-12345",
  address: "123 Main St, Detroit, MI 48201",
  website: "https://muy-rico.com",
  businessType: "cottage",
  tagline: "",
  email: "hi@muy-rico.com",
  acceptedMethods: { stripe: true, paypal: false, cashapp: true, venmo: true, applepay: false, cash: true },
  cashtag: "$muyrico",
  venmoHandle: "muy-rico",
  applePayEnabled: false,
  stripeConnected: true,
  reminders: DEFAULT_REMINDER_CONFIG,
};

async function loadPdf(bytes: Uint8Array): Promise<{ doc: PDFDocument; pages: number }> {
  const doc = await PDFDocument.load(bytes);
  return { doc, pages: doc.getPageCount() };
}

// ── Product profiles ────────────────────────────────────────────────────────

const PRODUCTS = [
  {
    name: "Cupcakes",
    conf: {
      productName: "Cupcakes (6) (Chocolate Frosting)",
      details: "Handmade vanilla cupcakes with chocolate frosting",
      ingredients: "Flour, cane sugar, unsalted butter, eggs, cocoa powder, vanilla extract, baking powder, salt, milk",
      allergens: "Contains: wheat, milk, eggs.",
      netWeightUS: "12 oz",
      netWeightMetric: "340 g",
      price: "$18.00",
      allergenTags: ["Wheat", "Milk", "Eggs"],
    },
  },
  {
    name: "Bolillos",
    conf: {
      productName: "Bolillos (Pack of 4)",
      details: "Traditional Mexican bolillo rolls, fresh daily",
      ingredients: "Wheat flour, water, vegetable shortening, yeast, sugar, salt",
      allergens: "Contains: wheat.",
      netWeightUS: "14 oz",
      netWeightMetric: "397 g",
      price: "$8.00",
      allergenTags: ["Wheat"],
    },
  },
  {
    name: "Conchas",
    conf: {
      productName: "Conchas (Pack of 4) (Vainilla)",
      details: "Classic Mexican sweet bread with vanilla topping",
      ingredients: "Wheat flour, sugar, butter, eggs, milk, yeast, vanilla, salt, shortening",
      allergens: "Contains: wheat, milk, eggs.",
      netWeightUS: "16 oz",
      netWeightMetric: "454 g",
      price: "$14.00",
      allergenTags: ["Wheat", "Milk", "Eggs"],
    },
  },
  {
    name: "Cakepops",
    conf: {
      productName: "Cakepops (Pack of 4) (Chocolate Coating)",
      details: "Cake pops dipped in Belgian chocolate",
      ingredients: "Cake flour, sugar, butter, eggs, cocoa, milk, white chocolate, sprinkles, vanilla extract",
      allergens: "Contains: wheat, milk, eggs, soybeans.",
      netWeightUS: "6 oz",
      netWeightMetric: "170 g",
      price: "$12.00",
      allergenTags: ["Wheat", "Milk", "Eggs", "Soybeans"],
    },
  },
  {
    name: "Empanadas",
    conf: {
      productName: "Empanadas (Pack of 6) (Cajeta)",
      details: "Handmade empanadas filled with goat's milk caramel",
      ingredients: "Wheat flour, lard, sugar, goat milk caramel, cinnamon, eggs, salt",
      allergens: "Contains: wheat, milk, eggs.",
      netWeightUS: "18 oz",
      netWeightMetric: "510 g",
      price: "$20.00",
      allergenTags: ["Wheat", "Milk", "Eggs"],
    },
  },
  {
    name: "Cinnamon Rolls",
    conf: {
      productName: "Cinnamon Rolls (Pack of 4)",
      details: "Soft rolls swirled with cinnamon brown sugar filling, cream cheese frosting",
      ingredients: "Flour, butter, brown sugar, cream cheese, eggs, cinnamon, milk, yeast, powdered sugar, vanilla",
      allergens: "Contains: wheat, milk, eggs.",
      netWeightUS: "22 oz",
      netWeightMetric: "624 g",
      price: "$16.00",
      allergenTags: ["Wheat", "Milk", "Eggs"],
    },
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PDF export regression suite", () => {
  let renderLabelPdf: typeof import("./labelExport").renderLabelPdf;

  beforeAll(async () => {
    const mod = await import("./labelExport");
    renderLabelPdf = mod.renderLabelPdf;
  });

  // ── Batch 1 ──────────────────────────────────────────────────────────────

  describe("BATCH 1: consecutive exports — deterministic and stable", () => {
    for (const prod of PRODUCTS) {
      it(`"${prod.name}" — 10 consecutive renders all produce valid 1-page PDFs`, async () => {
        const label = makeLabel(prod.conf);
        for (let i = 0; i < 10; i++) {
          const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
          expect(bytes).toBeInstanceOf(Uint8Array);
          expect(bytes.length).toBeGreaterThan(100);
          const { pages } = await loadPdf(bytes);
          expect(pages).toBe(1);
        }
      });

      it(`"${prod.name}" — sizes are stable across 5 consecutive renders (±1%)`, async () => {
        const label = makeLabel(prod.conf);
        const sizes: number[] = [];
        for (let i = 0; i < 5; i++) {
          sizes.push((await renderLabelPdf(label, profile, { sheet: "single" })).length);
        }
        const avg = sizes.reduce((s, v) => s + v, 0) / sizes.length;
        for (const s of sizes) {
          expect(Math.abs(s - avg) / avg).toBeLessThan(0.01);
        }
      });
    }
  });

  // ── Batch 2 ──────────────────────────────────────────────────────────────

  describe("BATCH 2: all products produce valid, loadable PDFs", () => {
    for (const prod of PRODUCTS) {
      it(`"${prod.name}" — renders a valid 1-page PDF`, async () => {
        const label = makeLabel(prod.conf);
        const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
        const { pages } = await loadPdf(bytes);
        expect(pages).toBe(1);
      });

      it(`"${prod.name}" — renders a valid sheet PDF (5163 2×4)`, async () => {
        const label = makeLabel({ ...prod.conf, averyPreset: "5163" });
        const bytes = await renderLabelPdf(label, profile, { sheet: "5163", copies: 8 });
        const { pages } = await loadPdf(bytes);
        expect(pages).toBe(1);
      });
    }
  });

  // ── Batch 3 ──────────────────────────────────────────────────────────────

  describe("BATCH 3: rapid mixed-mode export streak (single → sheet → single)", () => {
    for (const prod of PRODUCTS) {
      it(`"${prod.name}" — 3 single, 1 sheet, 3 single (all valid)`, async () => {
        const label = makeLabel(prod.conf);

        const singleBufs: Uint8Array[] = [];
        for (let i = 0; i < 3; i++) {
          const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
          const { pages } = await loadPdf(bytes);
          expect(pages).toBe(1);
          singleBufs.push(bytes);
        }

        const sheetLabel = makeLabel({ ...prod.conf, averyPreset: "5164" });
        const sheetBytes = await renderLabelPdf(sheetLabel, profile, { sheet: "5164", copies: 6 });
        const { pages: sheetPages } = await loadPdf(sheetBytes);
        expect(sheetPages).toBe(1);

        for (let i = 0; i < 3; i++) {
          const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
          const { pages } = await loadPdf(bytes);
          expect(pages).toBe(1);
        }

        const firstLoad = await loadPdf(singleBufs[0]);
        expect(firstLoad.pages).toBe(1);

        const lastLoad = await loadPdf(singleBufs[2]);
        expect(lastLoad.pages).toBe(1);
      });
    }
  });

  // ── Batch 4 ──────────────────────────────────────────────────────────────

  describe("BATCH 4: Blob boundary (simulating downloadPdf)", () => {
    for (const prod of PRODUCTS) {
      it(`"${prod.name}" — blob bytes match raw bytes`, async () => {
        const label = makeLabel(prod.conf);
        const bytes = await renderLabelPdf(label, profile, { sheet: "single" });

        const blob = new Blob([bytes], { type: "application/pdf" });
        const blobBytes = new Uint8Array(await blob.arrayBuffer());

        expect(blobBytes.length).toBe(bytes.length);
        expect(blobBytes.every((b, i) => b === bytes[i])).toBe(true);

        const { pages } = await loadPdf(blobBytes);
        expect(pages).toBe(1);
      });
    }
  });

  // ── Batch 5 ──────────────────────────────────────────────────────────────

  describe("BATCH 5: multi-page sheet export correctness", () => {
    it("5164 (2×3) with 12 copies → 2 pages", async () => {
      const label = makeLabel({ ...PRODUCTS[0].conf, averyPreset: "5164" });
      const bytes = await renderLabelPdf(label, profile, { sheet: "5164", copies: 12 });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(2);
    });

    it("5163 (2×4) with 24 copies → 3 pages", async () => {
      const label = makeLabel({ ...PRODUCTS[1].conf, averyPreset: "5163" });
      const bytes = await renderLabelPdf(label, profile, { sheet: "5163", copies: 24 });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(3);
    });

    it("5163 (2×4) with 3 copies → 1 page", async () => {
      const label = makeLabel({ ...PRODUCTS[2].conf, averyPreset: "5163" });
      const bytes = await renderLabelPdf(label, profile, { sheet: "5163", copies: 3 });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(1);
    });
  });

  // ── Batch 6 ──────────────────────────────────────────────────────────────

  describe("BATCH 6: orientation and shape variants", () => {
    it("landscape orientation renders valid PDF", async () => {
      const label = makeLabel({ ...PRODUCTS[0].conf, orientation: "landscape" });
      const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(1);
    });

    it("circle shape renders valid PDF", async () => {
      const label = makeLabel({ ...PRODUCTS[1].conf, shape: "circle" });
      const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(1);
    });

    it("square shape renders valid PDF", async () => {
      const label = makeLabel({ ...PRODUCTS[2].conf, shape: "square", labelWidth: 3, labelHeight: 3 });
      const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(1);
    });

    it("oval shape renders valid PDF", async () => {
      const label = makeLabel({ ...PRODUCTS[3].conf, shape: "oval" });
      const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(1);
    });
  });

  // ── Batch 7 ──────────────────────────────────────────────────────────────

  describe("BATCH 7: long ingredient / disclaimer text", () => {
    it("renders label with very long ingredient list", async () => {
      const label = makeLabel({
        ...PRODUCTS[4].conf,
        ingredients: "Enriched wheat flour (flour, niacin, reduced iron, thiamine mononitrate, riboflavin, folic acid), cane sugar, unsalted butter (cream, salt), whole eggs, cocoa powder processed with alkali, vanilla extract (vanilla bean extractives, alcohol, water, corn syrup), baking powder (sodium acid pyrophosphate, sodium bicarbonate, corn starch, monocalcium phosphate), sea salt, whole milk, ground cinnamon, nutmeg, allspice, cloves, ginger, cardamom",
        allergens: "Contains: wheat, milk, eggs.",
      });
      const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(1);
      expect(bytes.length).toBeGreaterThan(200);
    });

    it("renders label with many allergens including tree nuts and sesame", async () => {
      const label = makeLabel({
        ...PRODUCTS[5].conf,
        ingredients: "Flour, almonds, pecans, sugar, butter, eggs, sesame seeds, vanilla",
        allergens: "Contains: wheat, tree nuts (almonds, pecans), eggs, milk, sesame.",
        allergenTags: ["Wheat", "Tree Nuts", "Eggs", "Milk", "Sesame"],
      });
      const bytes = await renderLabelPdf(label, profile, { sheet: "single" });
      const { pages } = await loadPdf(bytes);
      expect(pages).toBe(1);
      expect(bytes.length).toBeGreaterThan(200);
    });
  });
});

// ── Mobile PDF helpers (openPdfInNewTab / sharePdf) ──────────────────────────

describe("mobile PDF helpers", () => {
  let openPdfInNewTab: typeof import("./labelExport").openPdfInNewTab;
  let sharePdf: typeof import("./labelExport").sharePdf;

  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]); // "%PDF-1"

  let createUrlSpy: ReturnType<typeof vi.fn>;
  let revokeUrlSpy: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const mod = await import("./labelExport");
    openPdfInNewTab = mod.openPdfInNewTab;
    sharePdf = mod.sharePdf;
  });

  beforeEach(() => {
    createUrlSpy = vi.fn(() => "blob:mock");
    revokeUrlSpy = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrlSpy });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrlSpy });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("openPdfInNewTab navigates the pre-opened window to the blob URL", () => {
    vi.useFakeTimers();
    const win = { location: { href: "about:blank" } } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    openPdfInNewTab(bytes, win);
    expect(win.location.href).toBe("blob:mock");
    expect(createUrlSpy).toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(revokeUrlSpy).toHaveBeenCalledWith("blob:mock");
  });

  it("openPdfInNewTab opens its own window when none is provided", () => {
    vi.useFakeTimers();
    const win = { location: { href: "" } } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(win as Window);
    openPdfInNewTab(bytes);
    expect(window.open).toHaveBeenCalledWith("blob:mock", "_blank");
    vi.advanceTimersByTime(60000);
    expect(revokeUrlSpy).toHaveBeenCalledWith("blob:mock");
  });

  it("openPdfInNewTab falls back to a download when the popup is blocked", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "open").mockReturnValue(null);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(() => openPdfInNewTab(bytes)).not.toThrow();
    expect(clickSpy).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeUrlSpy).toHaveBeenCalledWith("blob:mock");
  });

  it("sharePdf returns false when the Web Share API is unavailable", async () => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    expect(await sharePdf(bytes, "label.pdf")).toBe(false);
  });

  it("sharePdf shares the file via the system share sheet", async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });
    const ok = await sharePdf(bytes, "label.pdf");
    expect(ok).toBe(true);
    expect(shareSpy).toHaveBeenCalledWith(
      expect.objectContaining({ title: "label.pdf", files: [expect.any(File)] }),
    );
  });

  it("sharePdf treats a cancelled share sheet as handled", async () => {
    const shareSpy = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: shareSpy });
    expect(await sharePdf(bytes, "label.pdf")).toBe(true);
  });

  it("sharePdf returns false when the platform cannot share files", async () => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
    Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn() });
    expect(await sharePdf(bytes, "label.pdf")).toBe(false);
  });
});
