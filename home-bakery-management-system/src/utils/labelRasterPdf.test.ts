import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import zlib from "zlib";
import { renderRasterPdf } from "./labelRasterPdf";

// ── Tiny valid 2×2 PNG fixture (node zlib — no canvas needed) ────────────────

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
      raw[o] = 200;
      raw[o + 1] = 120;
      raw[o + 2] = 60;
    }
  }
  const idat = zlib.deflateSync(raw);
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return "data:image/png;base64," + Buffer.from(png).toString("base64");
}

function countImageStreams(doc: PDFDocument): number {
  return doc.context.enumerateIndirectObjects().filter(([, obj]) => {
    if (!(obj instanceof PDFRawStream)) return false;
    return obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image");
  }).length;
}

describe("renderRasterPdf", () => {
  it("single label → 1 page sized exactly to the label (in points)", async () => {
    const bytes = await renderRasterPdf(tinyPngDataUrl(), { effWIn: 3, effHIn: 4, sheet: "single" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(3 * 72, 0);
    expect(page.getHeight()).toBeCloseTo(4 * 72, 0);
    expect(Math.abs(page.getWidth() - 216)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(page.getHeight() - 288)).toBeLessThanOrEqual(0.5);
  });

  it('"5164" default copies (6) → 1 letter page 612×792', async () => {
    const bytes = await renderRasterPdf(tinyPngDataUrl(), { effWIn: 3, effHIn: 4, sheet: "5164" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(612, 0);
    expect(page.getHeight()).toBeCloseTo(792, 0);
  });

  it('"5164" with 12 copies → 2 letter pages', async () => {
    const bytes = await renderRasterPdf(tinyPngDataUrl(), {
      effWIn: 3,
      effHIn: 4,
      sheet: "5164",
      copies: 12,
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("embeds the PNG exactly once (even across 6 sheet copies)", async () => {
    const bytes = await renderRasterPdf(tinyPngDataUrl(), { effWIn: 3, effHIn: 4, sheet: "5164" });
    const doc = await PDFDocument.load(bytes);
    expect(countImageStreams(doc)).toBe(1);
  });

  it("unknown sheet preset falls back to single", async () => {
    const bytes = await renderRasterPdf(tinyPngDataUrl(), {
      effWIn: 3,
      effHIn: 4,
      sheet: "nope" as "single",
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(216, 0);
  });
});
