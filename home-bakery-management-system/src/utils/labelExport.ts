/**
 * Label PDF export via pdf-lib.
 * Consumes a LabelTemplate + business profile → produces vector PDF bytes.
 * The editor's normalized 0..1 coordinate system maps directly to PDF points.
 */
import { PDFDocument, StandardFonts, rgb, degrees, PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import type { LabelTemplate, LabelElement, BusinessProfile, NfpData } from "../types";
import { effectiveText, formatBestBy, resolveBestBy } from "./labelText";
import { NFP_ROWS, dvPercent } from "./nfpRows";

// Brand fonts — Vite resolves these to URLs; we fetch the bytes at runtime for pdf-lib embedding
import cormorantUrl from "../assets/fonts/CormorantGaramond-Regular.ttf";
import quicksandUrl from "../assets/fonts/Quicksand-Regular.ttf";

const PT_PER_IN = 72;

const TEXT_FIELDS: string[] = [
  "businessName", "businessId", "productName", "details", "ingredients",
  "allergens", "netWeight", "price", "bestBy", "disclaimer",
];

/** User-safe error for export failures; UI paths catch this and surface a toast. */
export class ExportError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ExportError";
  }
}

const _fontBytes: { cormorant?: ArrayBuffer; quicksand?: ArrayBuffer } = {};

async function getFonts(doc: PDFDocument) {
  doc.registerFontkit(fontkit);
  if (!_fontBytes.cormorant) {
    [_fontBytes.cormorant, _fontBytes.quicksand] = await Promise.all([
      fetch(cormorantUrl).then((r) => r.arrayBuffer()),
      fetch(quicksandUrl).then((r) => r.arrayBuffer()),
    ]);
  }
  const [cormorant, quicksand, helv, helvBold] = await Promise.all([
    doc.embedFont(_fontBytes.cormorant!),
    doc.embedFont(_fontBytes.quicksand!),
    doc.embedFont(StandardFonts.Helvetica),
    doc.embedFont(StandardFonts.HelveticaBold),
  ]);
  return { cormorant, quicksand, helv, helvBold };
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

/**
 * Detect the raster image format of a data URL or raw byte buffer.
 * Data-URL prefix wins when present; otherwise sniff magic bytes.
 * Throws for anything that isn't PNG or JPEG.
 */
export function sniffImageMime(input: string | Uint8Array): "png" | "jpg" {
  if (typeof input === "string") {
    if (input.startsWith("data:image/png")) return "png";
    if (input.startsWith("data:image/jpeg") || input.startsWith("data:image/jpg")) return "jpg";
    throw new Error("labelExport: unknown image data-url type");
  }
  const b = input;
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  throw new Error("labelExport: unknown image bytes (not PNG or JPEG)");
}

export interface AveryLayout { labelW: number; labelH: number; cols: number; rows: number; marginLeft: number; marginTop: number; gapH: number; gapV: number; }
export const AVERY_LAYOUTS: Record<string, AveryLayout> = {
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

  const sheet = opts.sheet || label.averyPreset || "single";
  const layout = AVERY_LAYOUTS[sheet] || AVERY_LAYOUTS.single;

  let lw = label.labelWidth || 3;
  let lh = label.labelHeight || 4;
  if (sheet !== "single") {
    lw = layout.labelW;
    lh = layout.labelH;
  } else if (label.orientation === "landscape" && !isSquareish) {
    [lw, lh] = [lh, lw];
  }
  if (isSquareish) { const s = Math.min(lw, lh); lw = s; lh = s; }
  const labelWPt = lw * PT_PER_IN;
  const labelHPt = lh * PT_PER_IN;

  // Best-by date: shared resolution logic with the canvas preview
  const bestByDateStr = label.showBestBy ? formatBestBy(resolveBestBy(label)) : "";

  // Background
  const bg = (() => { try { return hexToRgb(label.bgColor); } catch { return rgb(1,1,1); } })();

  // Match editor container: border-4 (3pt) + padding (3% non-curved, 6% curved)
  const isCurved = shape === "circle" || shape === "oval";
  const padPct = isCurved ? 0.06 : 0.03;
  const BORDER_PT = 3;
  const paddingBoxW = labelWPt - 2 * BORDER_PT;
  const paddingBoxH = labelHPt - 2 * BORDER_PT;
  const contentBoxW = labelWPt - 2 * BORDER_PT - 2 * (padPct * labelWPt);

  async function renderLabelOnPage(page: PDFPage, ox: number, oy: number) {
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
      if (el.type === "text" || (el.field !== undefined && TEXT_FIELDS.includes(el.field))) {
        drawTextElementOffset(page, el, label, profile, fonts, paddingBoxW, paddingBoxH, elOx, elOy, bestByDateStr, contentBoxW);
      } else if (el.field === "qr" || el.type === "qr") {
        await drawQrElementOffset(page, el, doc, paddingBoxW, paddingBoxH, elOx, elOy);
      } else if (el.field === "logo" || el.type === "logo") {
        await drawLogoElementOffset(page, el, doc, paddingBoxW, paddingBoxH, elOx, elOy);
      } else if (el.field === "nfp" || el.type === "nfp") {
        drawNfpElementOffset(page, el, label, fonts, paddingBoxW, paddingBoxH, elOx, elOy);
      } else {
        drawShapeElementOffset(page, el, label, paddingBoxW, paddingBoxH, elOx, elOy);
      }
    }
  }

  // Offset versions of draw functions
  function drawTextElementOffset(page: PDFPage, el: LabelElement, label: LabelTemplate, profile: BusinessProfile, fonts: any, pageW: number, pageH: number, ox: number, oy: number, bestBy?: string, contentBoxW?: number) {
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

  // Emoji logos can't be embedded as text in Helvetica (tofu); warn once per
  // export and skip — the raster path is the fidelity path for emoji.
  let emojiLogoWarned = false;

  async function drawQrElementOffset(page: PDFPage, el: LabelElement, doc: PDFDocument, pageW: number, pageH: number, ox: number, oy: number) {
    const website = el.qrValue || label.websiteUrl || profile.website || "https://muy-rico.com";
    const size = Math.min(el.w * pageW, el.h * pageH);
    const x = el.x * pageW + ox;
    const y = oy + pageH - (el.y * pageH) - size;
    try {
      const dataUrl = await QRCode.toDataURL(website, { width: 256, margin: 1 });
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
      const img = await doc.embedPng(bytes);
      page.drawImage(img, { x, y, width: size, height: size });
    } catch (err) {
      console.warn("labelExport: QR embed failed:", err);
      throw new ExportError("Could not generate the QR code for this label.", err);
    }
  }

  async function drawLogoElementOffset(page: PDFPage, el: LabelElement, doc: PDFDocument, pageW: number, pageH: number, ox: number, oy: number) {
    if (!label.logoImage) {
      if (label.logoEmoji && !emojiLogoWarned) {
        emojiLogoWarned = true;
        console.warn("labelExport: emoji logos are skipped in vector PDF export — use “PDF exact” for pixel-perfect emoji logos.");
      }
      return;
    }
    const w = el.w * pageW;
    const h = el.h * pageH;
    const x = el.x * pageW + ox;
    const y = oy + pageH - (el.y * pageH) - h;
    try {
      const res = await fetch(label.logoImage);
      if (!res.ok) throw new Error(`logo fetch failed (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const mime = sniffImageMime(bytes);
      const img = mime === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      page.drawImage(img, { x, y, width: w, height: h });
    } catch (err) {
      console.warn("labelExport: logo embed failed:", err);
      throw new ExportError("Could not embed the logo image in the PDF.", err);
    }
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
    const x = el.x * pageW + ox;
    const yBottom = oy + pageH - (el.y * pageH) - (el.h * pageH);
    const w = el.w * pageW;
    const h = el.h * pageH;
    const top = yBottom + h;
    const borderC = colorOf(el, label);

    // Mirrors the canvas NfpNode layout so labels/DV values match the preview.
    const rows = NFP_ROWS.filter(
      (r) => r.group !== "micro" || (data[r.key] || "").trim() !== ""
    );
    const NFP_PLACEHOLDER: Partial<Record<keyof NfpData, string>> = {
      servingSize: "1 serving",
      servings: "1",
    };
    const border = 2;
    const padX = w * 0.035;
    const padY = h * 0.02;
    const innerW = w - padX * 2;
    const slot = h / (rows.length + 3);
    const titleFs = slot * 1.0;
    const rowFs = slot * 0.48;
    const headFs = slot * 0.42;
    const footFs = slot * 0.34;
    const dvColW = innerW * 0.16;
    const valGap = innerW * 0.01;
    const indentW = w * 0.03;
    const titleSep = Math.max(2, slot * 0.14);
    const titleFont = fonts.helvBold;
    const rowFont = fonts.helv;
    const rowFontBold = fonts.helvBold;

    // Canvas y grows downward from padY; convert to PDF y (upward from bottom).
    const toPdfY = (yDown: number) => top - yDown;

    page.drawRectangle({ x, y: yBottom, width: w, height: h, color: rgb(1, 1, 1) });
    page.drawRectangle({ x, y: yBottom, width: w, height: h, borderColor: borderC, borderWidth: border, color: undefined });

    let y = padY;

    // Title
    page.drawText("Nutrition Facts", {
      x: x + padX,
      y: toPdfY(y) - titleFs * 0.85,
      size: titleFs,
      font: titleFont,
      color: rgb(0, 0, 0),
    });
    y += slot * 1.05;
    page.drawLine({
      start: { x: x + padX, y: toPdfY(y) },
      end: { x: x + padX + innerW, y: toPdfY(y) },
      thickness: titleSep,
      color: rgb(0, 0, 0),
    });
    y += titleSep;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const raw = (data[r.key] || "").trim();
      const val = raw || NFP_PLACEHOLDER[r.key] || "0";
      const dv = dvPercent(raw, r.dvThreshold);
      const ty = y + (slot - rowFs) / 2;
      const f = r.bold ? rowFontBold : rowFont;
      const lx = x + padX + r.indent * indentW;
      page.drawText(r.label, {
        x: lx,
        y: toPdfY(ty) - rowFs * 0.85,
        size: rowFs,
        font: f,
        color: rgb(0, 0, 0),
      });
      // Value column, right-aligned, leaving room for the %DV column
      const valW = innerW - dvColW - valGap;
      const valTextW = rowFont.widthOfTextAtSize(val, rowFs);
      page.drawText(val, {
        x: x + padX + Math.max(0, valW - valTextW),
        y: toPdfY(ty) - rowFs * 0.85,
        size: rowFs,
        font: f,
        color: rgb(0, 0, 0),
      });
      if (dv) {
        const dvTextW = rowFontBold.widthOfTextAtSize(dv, rowFs);
        page.drawText(dv, {
          x: x + padX + Math.max(0, innerW - dvTextW),
          y: toPdfY(ty) - rowFs * 0.85,
          size: rowFs,
          font: rowFontBold,
          color: rgb(0, 0, 0),
        });
      }

      const next = rows[i + 1];
      const sepW = r.key === "calories" ? 3 : next && next.group === "micro" ? 2 : 1;
      y += slot;
      page.drawLine({
        start: { x: x + padX, y: toPdfY(y) },
        end: { x: x + padX + innerW, y: toPdfY(y) },
        thickness: sepW,
        color: rgb(0, 0, 0),
      });

      if (r.key === "calories") {
        y += sepW;
        const dvHead = "% Daily Value*";
        const dvHeadW = rowFontBold.widthOfTextAtSize(dvHead, headFs);
        page.drawText(dvHead, {
          x: x + padX + Math.max(0, innerW - dvHeadW),
          y: toPdfY(y) - headFs * 0.85,
          size: headFs,
          font: rowFontBold,
          color: rgb(0, 0, 0),
        });
        y += slot * 0.7;
      }
    }

    // Footnote
    const footText =
      "* The % Daily Value tells you how much a nutrient in a serving of food contributes to a daily diet.";
    const footH = footFs * 1.15 * 2;
    const fy = Math.max(y + 2, h - padY - border - footH);
    page.drawLine({
      start: { x: x + padX, y: toPdfY(fy - 2) },
      end: { x: x + padX + innerW, y: toPdfY(fy - 2) },
      thickness: 1,
      color: rgb(0, 0, 0),
    });
    const footLines = wrapText(footText, rowFont, footFs, innerW);
    footLines.forEach((line, i) => {
      page.drawText(line, {
        x: x + padX,
        y: toPdfY(fy) - footFs * 0.85 - i * footFs * 1.15,
        size: footFs,
        font: rowFont,
        color: rgb(0, 0, 0),
      });
    });
  }

  if (sheet === "single") {
    const page = doc.addPage([labelWPt, labelHPt]);
    await renderLabelOnPage(page, 0, 0);
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
          await renderLabelOnPage(page, ox, oy);
          copy++;
        }
      }
    }
  }

  return doc.save();
}

/** Trigger a browser download of PDF bytes */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open PDF in a hidden iframe for printing */
export function printPdf(bytes: Uint8Array) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
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

/**
 * Open PDF bytes in a new tab — the reliable mobile path (iOS shows the native
 * PDF viewer with Share/Print). Pass `win` when the window was already opened
 * synchronously in the click handler to dodge popup blockers; otherwise we
 * open it here and fall back to a download if the popup is blocked.
 */
export function openPdfInNewTab(bytes: Uint8Array, win?: Window | null) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const REVOKE_MS = 60000;
  if (win) {
    win.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
    return;
  }
  const opened = window.open(url, "_blank");
  if (!opened) {
    downloadPdf(bytes, "label.pdf");
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_MS);
}

/**
 * Share PDF bytes via the Web Share API (iOS/Android share sheet — lists
 * Munbyn Print App, AirPrint, AirDrop, Messages…). Returns false when the
 * browser doesn't support file sharing so the caller can fall back.
 */
export async function sharePdf(bytes: Uint8Array, filename: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  const file = new File([new Uint8Array(bytes)], filename, { type: "application/pdf" });
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function") return false;
  try {
    if (!nav.canShare({ files: [file] })) return false;
    await nav.share({ files: [file], title: filename });
    return true;
  } catch {
    // User cancelled the sheet — treat as handled, not an error.
    return true;
  }
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
