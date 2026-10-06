import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import zlib from "zlib";
import {
  computeReceiptPages,
  receiptPdfFromCapture,
  dataUrlToBlob,
  receiptFileName,
} from "./receiptExport";

// Tiny valid 2×2 PNG fixture (node zlib — no canvas needed), same technique as
// labelRasterPdf.test.ts.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function tinyPngDataUrl(w = 2, h = 2): string {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = w * 3 + 1;
  const raw = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * stride + 1 + x * 3;
      raw[o] = 200; raw[o + 1] = 120; raw[o + 2] = 60;
    }
  }
  const idat = zlib.deflateSync(raw);
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return "data:image/png;base64," + Buffer.from(png).toString("base64");
}

describe("computeReceiptPages", () => {
  it("computes a single page for a short receipt", () => {
    const { pageCount, scale } = computeReceiptPages(794, 900);
    expect(pageCount).toBe(1);
    expect(scale).toBeGreaterThan(1);
  });

  it("paginates a long receipt and never returns zero pages", () => {
    expect(computeReceiptPages(794, 4000).pageCount).toBe(4);
    expect(computeReceiptPages(794, 2246).pageCount).toBe(3);
    expect(computeReceiptPages(794, 1).pageCount).toBe(1);
  });

  it("throws on invalid dimensions", () => {
    expect(() => computeReceiptPages(0, 100)).toThrow();
  });
});

describe("receiptPdfFromCapture", () => {
  it("builds an A4 PDF slicing a tall capture across pages", async () => {
    const capture = { dataUrl: tinyPngDataUrl(), widthPx: 794, heightPx: 4000 };
    const bytes = await receiptPdfFromCapture(capture);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(4);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(595.28, 1);
    expect(height).toBeCloseTo(841.89, 1);
  });
});

describe("receiptFileName / dataUrlToBlob", () => {
  it("builds language-tagged filenames and PNG blobs", () => {
    expect(receiptFileName("MR-7", "en", "pdf")).toBe("muy-rico-receipt-MR-7-en.pdf");
    expect(receiptFileName("MR-7", "es", "png")).toBe("muy-rico-receipt-MR-7-es.png");
    expect(receiptFileName("", "en", "pdf")).toBe("muy-rico-receipt-order-en.pdf");
    const blob = dataUrlToBlob(tinyPngDataUrl());
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });
});
