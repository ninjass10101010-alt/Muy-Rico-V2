/**
 * Branded invoice PDF via pdf-lib (same stack as the Label Studio).
 * Vector text, Letter page, cream/forest editorial styling — no images required.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Invoice, InvoiceItem } from "../types";
import cormorantUrl from "../assets/fonts/CormorantGaramond-Regular.ttf";
import quicksandUrl from "../assets/fonts/Quicksand-Regular.ttf";

const CREAM = rgb(0.98, 0.965, 0.925);   // #FAF6EC
const FOREST = rgb(0.118, 0.275, 0.212); // #1E4636
const INK = rgb(0.173, 0.145, 0.137);    // #2c2523
const MUTED = rgb(0.44, 0.4, 0.38);      // #706561
const RULE = rgb(0.89, 0.85, 0.8);

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;

const money = (cents: number) => "$" + (Number(cents) / 100).toFixed(2);

const _fontBytes: { cormorant?: ArrayBuffer; quicksand?: ArrayBuffer } = {};

async function getFonts(doc: PDFDocument) {
  doc.registerFontkit(fontkit);
  if (!_fontBytes.cormorant) {
    const [c, q] = await Promise.all([
      fetch(cormorantUrl).then((r) => r.arrayBuffer()),
      fetch(quicksandUrl).then((r) => r.arrayBuffer()),
    ]);
    _fontBytes.cormorant = c;
    _fontBytes.quicksand = q;
  }
  const [cormorant, quicksand, helvBold] = await Promise.all([
    doc.embedFont(_fontBytes.cormorant!),
    doc.embedFont(_fontBytes.quicksand!),
    doc.embedFont(StandardFonts.HelveticaBold),
  ]);
  return { cormorant, quicksand, helvBold };
}

function drawText(
  page: PDFPage, text: string, x: number, y: number,
  font: PDFFont, size: number, color = INK
) {
  page.drawText(text, { x, y, size, font, color });
}

function textWidth(text: string, font: PDFFont, size: number) {
  return font.widthOfTextAtSize(text, size);
}

function drawRight(
  page: PDFPage, text: string, rightX: number, y: number,
  font: PDFFont, size: number, color = INK
) {
  page.drawText(text, { x: rightX - textWidth(text, font, size), y, size, font, color });
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (textWidth(next, font, size) > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function buildInvoicePdf(invoice: Invoice, items: InvoiceItem[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const { cormorant, quicksand, helvBold } = await getFonts(doc);
  const page = doc.addPage([PAGE_W, PAGE_H]);

  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: CREAM });

  let y = PAGE_H - MARGIN;

  // Wordmark
  drawText(page, "Muy Rico", MARGIN, y - 6, cormorant, 30, FOREST);
  drawText(page, "AUTHENTIC MEXICAN BAKERY · HOLLAND, MI", MARGIN, y - 22, quicksand, 8, MUTED);

  drawRight(page, "INVOICE", PAGE_W - MARGIN, y - 6, helvBold, 16, FOREST);
  drawRight(page, invoice.number, PAGE_W - MARGIN, y - 24, quicksand, 10, MUTED);
  if (invoice.issueDate) drawRight(page, `Issued: ${invoice.issueDate}`, PAGE_W - MARGIN, y - 38, quicksand, 9, MUTED);
  if (invoice.dueDate) drawRight(page, `Due: ${invoice.dueDate}`, PAGE_W - MARGIN, y - 51, quicksand, 9, MUTED);

  y -= 78;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: RULE });

  // Bill-to
  y -= 22;
  drawText(page, "BILL TO", MARGIN, y, quicksand, 8, MUTED);
  drawText(page, invoice.customerName || "", MARGIN, y - 16, helvBold, 12, INK);
  if (invoice.email) drawText(page, invoice.email, MARGIN, y - 30, quicksand, 10, MUTED);
  if (invoice.phone) drawText(page, invoice.phone, MARGIN, y - 43, quicksand, 10, MUTED);

  // Items table
  y -= 74;
  const colDesc = MARGIN;
  const colQty = PAGE_W - MARGIN - 210;
  const colUnit = PAGE_W - MARGIN - 110;
  const colAmt = PAGE_W - MARGIN;
  drawText(page, "DESCRIPTION", colDesc, y, quicksand, 8, MUTED);
  drawText(page, "QTY", colQty, y, quicksand, 8, MUTED);
  drawRight(page, "UNIT", colUnit, y, quicksand, 8, MUTED);
  drawRight(page, "AMOUNT", colAmt, y, quicksand, 8, MUTED);
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: FOREST });
  y -= 18;

  for (const it of items) {
    const qty = Number(it.qty) || 1;
    const unit = Number(it.unit_price_cents) || 0;
    const lines = wrap(it.description || "", quicksand, 10, colQty - colDesc - 12);
    drawText(page, lines[0] || "", colDesc, y, quicksand, 10, INK);
    drawText(page, String(qty), colQty, y, quicksand, 10, MUTED);
    drawRight(page, money(unit), colUnit, y, quicksand, 10, MUTED);
    drawRight(page, money(qty * unit), colAmt, y, quicksand, 10, INK);
    y -= 14;
    for (let i = 1; i < lines.length; i++) {
      drawText(page, lines[i], colDesc, y, quicksand, 10, INK);
      y -= 14;
    }
    y -= 4;
    page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: PAGE_W - MARGIN, y: y + 6 }, thickness: 0.5, color: RULE });
    y -= 8;
  }

  // Totals
  y -= 8;
  const totalCents = Number(invoice.totalCents) || 0;
  const depositCents = Math.ceil(totalCents * 0.5);
  const showDeposit = invoice.paymentOptions !== "full";

  drawRight(page, "Total", colUnit, y, helvBold, 12, INK);
  drawRight(page, money(totalCents), colAmt, y, helvBold, 12, FOREST);
  if (showDeposit && totalCents > 0) {
    y -= 16;
    drawRight(page, "Deposit (50%) due now", colUnit, y, quicksand, 10, MUTED);
    drawRight(page, money(depositCents), colAmt, y, quicksand, 10, MUTED);
    y -= 14;
    drawRight(page, "Balance due at pickup", colUnit, y, quicksand, 10, MUTED);
    drawRight(page, money(totalCents - depositCents), colAmt, y, quicksand, 10, MUTED);
  }

  // Notes
  if (invoice.notes) {
    y -= 30;
    for (const line of wrap(invoice.notes, quicksand, 10, PAGE_W - MARGIN * 2)) {
      drawText(page, line, MARGIN, y, quicksand, 10, MUTED);
      y -= 13;
    }
  }

  // Footer
  const footerY = MARGIN + 26;
  page.drawLine({ start: { x: MARGIN, y: footerY + 14 }, end: { x: PAGE_W - MARGIN, y: footerY + 14 }, thickness: 0.5, color: RULE });
  drawText(page, "Muy Rico Bakery · Holland, MI", MARGIN, footerY, quicksand, 9, MUTED);
  drawRight(page, "muy-rico.com", PAGE_W - MARGIN, footerY, quicksand, 9, MUTED);

  return await doc.save();
}
