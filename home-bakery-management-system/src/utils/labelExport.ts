/**
 * Label PDF export via pdf-lib.
 * Consumes a LabelTemplate + business profile → produces vector PDF bytes.
 * The editor's normalized 0..1 coordinate system maps directly to PDF points.
 */
import { PDFDocument, StandardFonts, rgb, degrees, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import type { LabelTemplate, LabelElement, BusinessProfile } from "../types";
import { DISCLAIMER_STANDARD } from "./disclaimer";

// Brand fonts — Vite resolves these to URLs; we fetch the bytes at runtime for pdf-lib embedding
import cormorantUrl from "../assets/fonts/CormorantGaramond-Regular.ttf";
import quicksandUrl from "../assets/fonts/Quicksand-Regular.ttf";

const PT_PER_IN = 72;

let _fonts: { cormorant: any; quicksand: any; helv: any } | null = null;

async function getFonts(doc: PDFDocument) {
  if (_fonts) return _fonts;
  doc.registerFontkit(fontkit);
  const [cb, qb] = await Promise.all([
    fetch(cormorantUrl).then((r) => r.arrayBuffer()),
    fetch(quicksandUrl).then((r) => r.arrayBuffer()),
  ]);
  const cormorant = await doc.embedFont(cb);
  const quicksand = await doc.embedFont(qb);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  _fonts = { cormorant, quicksand, helv };
  return _fonts;
}

function hexToRgb(hex: string) {
  const m = hex.replace("#", "");
  const n = m.length === 3
    ? m.split("").map((c) => parseInt(c + c, 16))
    : [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)];
  return rgb(n[0] / 255, n[1] / 255, n[2] / 255);
}

function colorOf(el: LabelElement, label: LabelTemplate) {
  const c = el.colorOverride || label.textColor;
  try { return hexToRgb(c); } catch { return rgb(0.17, 0.14, 0.12); }
}

function pickFont(el: LabelElement, label: LabelTemplate, fonts: any) {
  const fam = el.fontFamilyOverride || label.font || "";
  if (fam.includes("Cormorant")) return fonts.cormorant;
  if (fam.includes("Quicksand")) return fonts.quicksand;
  return fonts.helv;
}

function fontSizePt(el: LabelElement, contentBoxW: number) {
  const cqw = el.fontSizeOverride ?? 4;
  return (cqw / 100) * contentBoxW;
}

function wrapText(text: string, font: any, size: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function effectiveText(el: LabelElement, label: LabelTemplate, profile: BusinessProfile, bestByDateStr?: string | null): string {
  const effName = label.businessName || profile.name;
  const effPhone = label.phoneNumber || profile.phone;
  const effReg = label.registrationNumber || profile.registrationNumber;
  const effAddr = label.address || profile.address;
  const isReg = label.businessIdMode === "registration";
  switch (el.field) {
    case "businessName": return effName;
    case "businessId": return isReg ? `${effPhone} \u00B7 ${effReg || ""}` : effAddr;
    case "productName": return label.productName || "Product Name";
    case "details": return label.details;
    case "ingredients": return label.ingredients ? `Ingredients: ${label.ingredients}` : "";
    case "allergens": return label.allergens;
    case "netWeight": return label.netWeightUS || label.netWeight || "";
    case "price": return label.showPrice ? label.price : "";
    case "bestBy": return label.showBestBy ? `Best by ${bestByDateStr || ""}` : "";
    case "disclaimer": return label.showDisclaimer ? DISCLAIMER_STANDARD : "";
    default: return "";
  }
}




interface AveryLayout { labelW: number; labelH: number; cols: number; rows: number; marginLeft: number; marginTop: number; gapH: number; gapV: number; }
const AVERY: Record<string, AveryLayout> = {
  single: { labelW: 3, labelH: 4, cols: 1, rows: 1, marginLeft: 0, marginTop: 0, gapH: 0, gapV: 0 },
  "5164": { labelW: 3.33, labelH: 4, cols: 2, rows: 3, marginLeft: 0.156, marginTop: 0.5, gapH: 0.25, gapV: 0 },
  "5163": { labelW: 4, labelH: 2, cols: 2, rows: 4, marginLeft: 0.156, marginTop: 0.5, gapH: 0.19, gapV: 0 },
  "8163": { labelW: 4, labelH: 2, cols: 2, rows: 4, marginLeft: 0.156, marginTop: 0.5, gapH: 0.19, gapV: 0 },
};

export async function renderLabelPdf(
  label: LabelTemplate,
  profile: BusinessProfile,
  opts: { sheet?: string; copies?: number } = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts = await getFonts(doc);
  const elements = label.elements || [];
  const shape = label.shape || "rounded";
  const isSquareish = shape === "square" || shape === "circle";
  let lw = label.labelWidth || 3;
  let lh = label.labelHeight || 4;
  if (label.orientation === "landscape" && !isSquareish) { [lw, lh] = [lh, lw]; }
  if (isSquareish) { const s = Math.min(lw, lh); lw = s; lh = s; }
  const labelWPt = lw * PT_PER_IN;
  const labelHPt = lh * PT_PER_IN;

  // Best-by date: use stored snapshot if present, else compute
  const bestByDateStr = (label as any).best_by_date
    ? new Date((label as any).best_by_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : new Date(Date.now() + ((label.bestByDays || 7) * 86400000)).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Background
  const bg = (() => { try { return hexToRgb(label.bgColor); } catch { return rgb(1,1,1); } })();

  // Match editor container: border-4 (3pt) + padding (3% non-curved, 6% curved)
  const isCurved = shape === "circle" || shape === "oval";
  const padPct = isCurved ? 0.06 : 0.03;
  const BORDER_PT = 3;
  const paddingBoxW = labelWPt - 2 * BORDER_PT;
  const paddingBoxH = labelHPt - 2 * BORDER_PT;
  const contentBoxW = labelWPt - 2 * BORDER_PT - 2 * (padPct * labelWPt);

  function renderLabelOnPage(page: PDFPage, ox: number, oy: number) {
    // Background
    page.drawRectangle({ x: ox, y: oy, width: labelWPt, height: labelHPt, color: bg });
    // Elements sorted by z
    const sorted = [...elements].sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const el of sorted) {
      if (el.hidden) continue;
      // Element positions are percentages of the padding box (inside border)
      // PDF draws at the border edge, so offset by BORDER_PT
      const elOx = ox + BORDER_PT;
      const elOy = oy + BORDER_PT;
      if (el.type === "text" || ["businessName","businessId","productName","details","ingredients","allergens","netWeight","price","bestBy","disclaimer"].includes(el.field)) {
        drawTextElementOffset(page, el, label, profile, fonts, paddingBoxW, paddingBoxH, elOx, elOy, bestByDateStr, contentBoxW);
      } else if (el.field === "qr" || el.type === "qr") {
        drawQrElementOffset(page, el, doc, paddingBoxW, paddingBoxH, elOx, elOy);
      } else if (el.field === "logo" || el.type === "logo") {
        drawLogoElementOffset(page, el, doc, paddingBoxW, paddingBoxH, elOx, elOy);
      } else if (el.field === "nfp" || el.type === "nfp") {
        drawNfpElementOffset(page, el, label, fonts, paddingBoxW, paddingBoxH, elOx, elOy);
      } else {
        drawShapeElementOffset(page, el, label, paddingBoxW, paddingBoxH, elOx, elOy);
      }
    }
  }

  // Offset versions of draw functions
  function drawTextElementOffset(page: PDFPage, el: LabelElement, label: LabelTemplate, profile: BusinessProfile, fonts: any, pageW: number, pageH: number, ox: number, oy: number, bestBy?: string | null, contentBoxW?: number) {
    const text = effectiveText(el, label, profile, bestBy);
    if (!text) return;
    const font = pickFont(el, label, fonts);
    const size = fontSizePt(el, contentBoxW ?? pageW);
    const color = colorOf(el, label);
    const w = el.w * pageW;
    const h = el.h * pageH;
    const align = el.alignOverride || "center";
    const lineH = size * 1.2;
    const lines = wrapText(text, font, size, w);
    const totalH = lines.length * lineH;
    // PDF draws at the baseline; text extends upward by ~ascent.
    // Editor positions text top-down (alignItems: flex-start).
    // Subtract ascent so the top of the first glyph aligns with the element top.
    const ascent = size * 0.75;
    const localStartY = pageH - (el.y * pageH) - (align === "center" ? (h - totalH) / 2 : 0) - ascent;
    const actualY = localStartY + oy;
    lines.forEach((line, i) => {
      const lineY = actualY - i * lineH;
      let lineX = el.x * pageW + ox;
      const tw = font.widthOfTextAtSize(line, size);
      if (align === "center") lineX = el.x * pageW + ox + (w - tw) / 2;
      else if (align === "right") lineX = el.x * pageW + ox + w - tw;
      page.drawText(line, { x: lineX, y: lineY, size, font, color, rotate: degrees(el.rotation || 0) });
    });
  }

  async function drawQrElementOffset(page: PDFPage, el: LabelElement, doc: PDFDocument, pageW: number, pageH: number, ox: number, oy: number) {
    const website = label.websiteUrl || "https://muy-rico.com";
    const size = Math.min(el.w * pageW, el.h * pageH);
    const x = el.x * pageW + ox;
    const y = oy + pageH - (el.y * pageH) - size;
    try {
      const dataUrl = await QRCode.toDataURL(website, { width: 256, margin: 1 });
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
      const img = await doc.embedPng(bytes);
      page.drawImage(img, { x, y, width: size, height: size });
    } catch {}
  }

  async function drawLogoElementOffset(page: PDFPage, el: LabelElement, doc: PDFDocument, pageW: number, pageH: number, ox: number, oy: number) {
    if (!label.logoImage) return;
    const w = el.w * pageW;
    const h = el.h * pageH;
    const x = el.x * pageW + ox;
    const y = oy + pageH - (el.y * pageH) - h;
    try {
      const res = await fetch(label.logoImage);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const img = label.logoImage!.includes(".png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      page.drawImage(img, { x, y, width: w, height: h });
    } catch {}
  }

  function drawShapeElementOffset(page: PDFPage, el: LabelElement, label: LabelTemplate, pageW: number, pageH: number, ox: number, oy: number) {
    const x = el.x * pageW + ox;
    const yBottom = oy + pageH - (el.y * pageH) - (el.h * pageH);
    const w = el.w * pageW;
    const h = el.h * pageH;
    const stroke = el.strokeColor ? hexToRgb(el.strokeColor) : colorOf(el, label);
    const fill = el.fillColor ? hexToRgb(el.fillColor) : undefined;
    const sw = (el.strokeWidth || 1) * 0.5;
    if (el.type === "circle") {
      page.drawEllipse({ x: x + w / 2, y: yBottom + h / 2, xScale: w / 2, yScale: h / 2, borderColor: stroke, borderWidth: sw, color: fill });
    } else if (el.type === "rect") {
      page.drawRectangle({ x, y: yBottom, width: w, height: h, borderColor: stroke, borderWidth: sw, color: fill });
    } else if (el.type === "line" || el.field === "divider") {
      page.drawLine({ start: { x, y: yBottom + h/2 }, end: { x: x + w, y: yBottom + h/2 }, thickness: sw, color: stroke });
    }
  }

  function drawNfpElementOffset(page: PDFPage, el: LabelElement, label: LabelTemplate, fonts: any, pageW: number, pageH: number, ox: number, oy: number) {
    const data = el.nfpData;
    if (!data) return;
    const font = fonts.helv;
    const x = el.x * pageW + ox;
    const yBottom = oy + pageH - (el.y * pageH) - (el.h * pageH);
    const w = el.w * pageW;
    const h = el.h * pageH;
    const top = yBottom + h;
    const borderC = colorOf(el, label);
    const labelSz = w * 0.028;
    const valSz = w * 0.025;
    const rowH = h / 14;
    page.drawRectangle({ x, y: yBottom, width: w, height: h, borderColor: borderC, borderWidth: 2, color: undefined });
    page.drawRectangle({ x, y: top - rowH * 1.5, width: w, height: rowH * 1.5, color: borderC });
    page.drawText("Nutrition Facts", { x: x + w * 0.04, y: top - rowH * 1.2, size: labelSz * 1.3, font, color: rgb(1,1,1) });
    const rows: [string, string][] = [
      [`Serving size: ${data.servingSize || ""}`, `${data.servings || ""} servings`],
      ["Calories", data.calories || ""],
      ["Total Fat", data.totalFat || ""],
      ["Saturated Fat", data.satFat || ""],
      ["Trans Fat", data.transFat || ""],
      ["Cholesterol", data.cholesterol || ""],
      ["Sodium", data.sodium || ""],
      ["Total Carbohydrate", data.totalCarb || ""],
      ["Dietary Fiber", data.fiber || ""],
      ["Sugars", data.sugars || ""],
      ["Added Sugars", data.addedSugars || ""],
      ["Protein", data.protein || ""],
    ];
    rows.forEach(([k, v], i) => {
      const ry = top - rowH * (1.5 + i + 1);
      page.drawText(k, { x: x + w * 0.04, y: ry, size: valSz, font, color: rgb(0.1,0.1,0.1) });
      page.drawText(v, { x: x + w * 0.55, y: ry, size: valSz, font, color: rgb(0.1,0.1,0.1) });
      page.drawLine({ start: {x, y: ry - 2}, end: {x: x + w, y: ry - 2}, thickness: 0.3, color: rgb(0.7,0.7,0.7) });
    });
  }

  // Sheet layout
  const sheet = opts.sheet || label.averyPreset || "single";
  const layout = AVERY[sheet] || AVERY.single;

  if (sheet === "single") {
    const page = doc.addPage([labelWPt, labelHPt]);
    renderLabelOnPage(page, 0, 0);
  } else {
    // Letter-size sheet
    const sheetW = 8.5 * PT_PER_IN;
    const sheetH = 11 * PT_PER_IN;
    const copies = opts.copies || (layout.cols * layout.rows);
    const perPage = layout.cols * layout.rows;
    const pages = Math.ceil(copies / perPage) || 1;
    let copy = 0;
    for (let p = 0; p < pages; p++) {
      const page = doc.addPage([sheetW, sheetH]);
      for (let r = 0; r < layout.rows; r++) {
        for (let c = 0; c < layout.cols; c++) {
          if (copy >= copies) break;
          const ox = (layout.marginLeft + c * (layout.labelW + layout.gapH)) * PT_PER_IN;
          const oy = (sheetH / PT_PER_IN - layout.marginTop - (r + 1) * layout.labelH - r * layout.gapV) * PT_PER_IN;
          renderLabelOnPage(page, ox, oy);
          copy++;
        }
      }
    }
  }

  return doc.save();
}

/** Trigger a browser download of PDF bytes */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Open PDF in a hidden iframe for printing */
export function printPdf(bytes: Uint8Array) {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => { URL.revokeObjectURL(url); iframe.remove(); }, 10000);
  };
}

// ─── Code-128 barcode (vector, no extra deps) ─────────────────────────────────
// Minimal Code Set B encoder. Covers ASCII printable chars (32..127).
// Each pattern is 11 modules (bars+spaces); we draw filled rectangles only.

const C128_START_B = [2, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2];
const C128_STOP   = [2, 3, 3, 1, 1, 1, 2, 1]; // 7 modules + terminating bar (2)
const C128_B_PATTERNS: number[][] = [
  // 0..106 → lookup table for values 32..127 (subset of Code B). We expose a full
  // 108-entry table for safety; values below 32 return [] and fall back to '?'.
  [2,1,2,2,2,2,2,2,2,2,2],[2,2,2,1,2,2,2,2,2,2,2],[2,2,2,2,2,1,2,2,2,2,2],
  [1,2,1,2,2,2,2,2,2,2,2],[1,2,2,3,2,2,2,2,2,2,2],[1,2,2,2,2,3,2,2,2,2,2],
  [1,3,2,1,2,2,2,2,2,2,2],[1,2,1,3,2,2,2,2,2,2,2],[1,2,1,1,2,3,2,2,2,2,2],
  [3,1,1,2,2,2,2,2,2,2,2],[3,1,1,1,2,2,2,2,2,2,2],[3,1,1,1,1,2,2,2,2,2,2],
  [3,1,1,1,1,1,2,2,2,2,2],[3,2,1,1,1,2,2,2,2,2,2],[3,2,1,1,1,1,2,2,2,2,2],
  [3,1,2,1,1,2,2,2,2,2,2],[3,1,2,1,1,1,2,2,2,2,2],[3,1,2,1,1,1,1,2,2,2,2],
  [2,3,1,2,1,2,2,2,2,2,2],[2,3,1,2,1,1,2,2,2,2,2],[2,3,1,1,1,2,2,2,2,2,2],
  [2,3,1,1,1,1,2,2,2,2,2],[2,3,1,1,1,1,1,2,2,2,2],[3,3,1,1,1,1,1,2,2,2,2],
  [3,1,2,1,2,1,2,2,2,2,2],[3,1,2,1,1,2,1,2,2,2,2],[3,1,2,1,1,1,2,1,2,2,2],
  [3,1,1,2,1,2,1,2,2,2,2],[3,1,1,2,1,1,2,1,2,2,2],[3,1,1,1,2,2,1,2,2,2,2],
  [3,3,1,1,1,1,2,1,2,2,2],[3,3,1,1,1,1,1,2,1,2,2],[3,3,1,1,1,1,1,1,2,2,2],
  [2,3,1,2,1,2,1,2,2,2,2],[2,3,1,2,1,1,2,1,2,2,2],[2,3,1,1,1,2,1,2,2,2,2],
  [2,3,1,1,1,1,2,1,2,2,2],[2,3,1,1,1,1,1,2,1,2,2],[2,1,2,2,1,2,1,2,2,2,2],
  [2,1,2,2,1,1,2,1,2,2,2],[2,1,2,1,2,2,1,2,2,2,2],[2,1,2,1,2,1,2,1,2,2,2],
  [2,1,2,1,2,1,1,2,1,2,2],[2,1,1,2,1,2,2,1,2,2,2],[2,1,1,2,1,1,2,1,2,2,2],
  [2,1,1,1,2,2,1,2,2,2,2],[2,1,1,1,2,1,2,1,2,2,2],[2,1,1,1,1,2,2,1,2,2,2],
  [2,1,1,1,1,1,2,1,2,2,2],[1,2,2,2,1,2,1,2,2,2,2],[1,2,2,1,2,2,1,2,2,2,2],
  [1,2,2,1,2,1,2,1,2,2,2],[1,2,2,1,2,1,1,2,1,2,2],[1,2,1,2,1,2,2,1,2,2,2],
  [1,2,1,2,1,1,2,1,2,2,2],[1,2,1,1,2,2,1,2,2,2,2],[1,2,1,1,2,1,2,1,2,2,2],
  [1,2,1,1,1,2,2,1,2,2,2],[1,2,1,1,1,1,2,1,2,2,2],[1,1,2,2,1,2,1,2,2,2,2],
  [1,1,2,1,2,2,1,2,2,2,2],[1,1,2,1,2,1,2,1,2,2,2],[1,1,2,1,1,2,2,1,2,2,2],
  [1,1,2,1,1,1,2,1,2,2,2],[1,2,2,1,1,2,1,2,2,2,2],[1,2,2,1,1,1,2,1,2,2,2],
  [1,1,2,2,1,1,2,1,2,2,2],[1,1,2,1,1,2,2,1,2,2,2],[1,1,2,1,1,1,2,1,2,2,2],
  [3,2,1,1,1,1,1,1,2,2,2],[3,2,1,1,1,1,1,2,1,2,2],[3,2,1,1,1,1,1,1,2,1,2],
  [3,2,1,1,1,1,1,1,1,2,2],[2,3,1,2,1,1,1,1,1,2,2],[2,3,1,1,1,2,1,1,1,2,2],
  [2,3,1,1,1,1,2,1,1,2,2],[2,1,2,1,1,2,1,1,1,2,2],[2,1,1,2,1,1,2,1,1,2,2],
  [2,1,1,1,1,2,2,1,1,2,2],[2,1,1,1,1,1,2,2,1,2,2],[1,3,2,1,1,1,1,1,2,2,2],
  [1,1,2,2,1,1,1,2,1,2,2],[1,1,1,2,1,2,1,1,2,2,2],[1,1,1,2,1,1,2,1,1,2,2],
  [1,1,1,1,2,2,1,2,1,2,2],[1,1,1,1,2,1,2,1,1,2,2],[1,1,1,1,1,2,2,1,1,2,2],
  [1,1,1,1,1,1,2,2,1,2,2],[1,3,1,1,1,1,1,1,1,2,2],[1,1,1,3,1,1,1,1,1,2,2],
  [1,1,1,1,1,3,1,1,1,2,2],[1,1,1,1,1,1,1,3,1,2,2],[3,1,1,1,1,1,1,1,1,2,2],
  [2,1,1,1,1,1,1,1,1,2,2],[1,2,1,1,1,1,1,1,1,2,2],[1,1,2,1,1,1,1,1,1,2,2],
  [1,1,1,2,1,1,1,1,1,2,2],[1,1,1,1,2,1,1,1,1,2,2],[1,1,1,1,1,2,1,1,1,2,2],
  [1,1,1,1,1,1,2,1,1,1,2],[3,1,1,1,1,1,1,1,1,1,2],[2,1,1,1,1,1,1,1,1,1,2],
  [1,2,1,1,1,1,1,1,1,1,2],[1,1,2,1,1,1,1,1,1,1,2],[1,1,1,2,1,1,1,1,1,1,2],
  [1,1,1,1,2,1,1,1,1,1,2],[1,1,1,1,1,2,1,1,1,1,2],[1,1,1,1,1,1,2,1,1,1,1],
];
// Code Set B character → value (0..105). Values 106=Start B, 107=Stop.
const C128_B_CHARS: string[] = [];
for (let i = 32; i < 127; i++) C128_B_CHARS[i - 32] = String.fromCharCode(i);
C128_B_CHARS.push(""); // 106 unused placeholder

export interface Code128Pattern { bars: { x: number; w: number }[]; totalModules: number }

/**
 * Encode a string for Code Set B. Replaces unsupported chars with '?' (value 1).
 * Returns a flat pattern of bar widths (in module units). Caller scales to page coords.
 */
export function encodeCode128B(text: string): { pattern: number[]; checksum: number } {
  const pattern: number[] = [...C128_START_B];
  let checksum = 104; // Start B value
  let pos = 1; // checksum weighting starts at 1
  for (const ch of text) {
    const idx = C128_B_CHARS.indexOf(ch);
    let value: number;
    if (idx >= 0) {
      value = idx;
    } else if (ch === " ") {
      value = 0; // space
    } else {
      value = 1; // '!' as safe placeholder for unsupported
    }
    pattern.push(...C128_B_PATTERNS[value]);
    checksum += value * pos;
    pos += 1;
  }
  // Stop pattern
  checksum += 106 * pos; // 106 is Stop symbol weight
  pattern.push(...C128_STOP);
  return { pattern, checksum: checksum % 103 };
}

/**
 * Draw a Code-128 barcode rectangle at the given pdf-lib page coords.
 * `quiet` is the empty margin in module units on each side (default 10).
 */
export function drawCode128Pdf(
  page: PDFPage,
  text: string,
  opts: { x: number; y: number; width: number; height: number; color?: ReturnType<typeof rgb>; font?: any; fontSize?: number; quiet?: number }
) {
  const { x, y, width, height, color = rgb(0, 0, 0), font, fontSize = 7, quiet = 10 } = opts;
  if (!text) return;
  const { pattern } = encodeCode128B(text);
  const totalModules = pattern.reduce((s, m) => s + m, 0) + 2 * quiet;
  const moduleW = width / totalModules;
  // The barcode is drawn from the bottom up; reserve space at the top for human-readable text.
  const textH = font ? fontSize * 1.1 : 0;
  const barH = Math.max(0, height - textH - 1);
  let cx = x + quiet * moduleW;
  for (let i = 0; i < pattern.length; i++) {
    const m = pattern[i];
    // Odd indices are bars (filled), even are spaces
    if (i % 2 === 0) {
      page.drawRectangle({
        x: cx,
        y: y + textH + 1,
        width: m * moduleW,
        height: barH,
        color,
      });
    }
    cx += m * moduleW;
  }
  if (font) {
    const tw = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: x + (width - tw) / 2,
      y: y,
      size: fontSize,
      font,
      color,
    });
  }
}
