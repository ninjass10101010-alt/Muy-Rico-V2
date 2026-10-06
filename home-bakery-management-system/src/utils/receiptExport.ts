// Receipt file export: one DOM capture feeds BOTH the PNG deliverable and the
// PDF (embedded image), so the two formats can never drift apart.
import { PDFDocument } from "pdf-lib";
import { toPng } from "html-to-image";
import quicksandUrl from "../assets/fonts/Quicksand-Regular.ttf";
import cormorantUrl from "../assets/fonts/CormorantGaramond-Regular.ttf";

export type ReceiptFileFormat = "png" | "pdf";

export interface ReceiptCapture {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

export const RECEIPT_DOC_WIDTH_PX = 794; // A4 width at 96 dpi

const A4_W_PT = 595.28;
const A4_H_PT = 841.89;

export function computeReceiptPages(widthPx: number, heightPx: number): {
  pageCount: number;
  scale: number;
  pageHeightPx: number;
} {
  if (!(widthPx > 0) || !(heightPx > 0)) {
    throw new Error("Invalid receipt capture dimensions");
  }
  const scale = widthPx / A4_W_PT;
  const pageHeightPx = A4_H_PT * scale;
  const pageCount = Math.max(1, Math.ceil(heightPx / pageHeightPx));
  return { pageCount, scale, pageHeightPx };
}

function waitForImages(node: HTMLElement): Promise<void> {
  const imgs = Array.from(node.querySelectorAll("img"));
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// html-to-image's getFontEmbedCSS() scans cross-origin stylesheets (Google
// Fonts) and triggers a SecurityError console error. We only need the two
// bundled brand TTFs, so embed those ourselves.
async function buildReceiptFontEmbedCss(): Promise<string> {
  const [quicksand, cormorant] = await Promise.all([
    fetch(quicksandUrl).then((res) => {
      if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
      return res.arrayBuffer();
    }),
    fetch(cormorantUrl).then((res) => {
      if (!res.ok) throw new Error(`Font fetch failed: ${res.status}`);
      return res.arrayBuffer();
    }),
  ]);
  return [
    `@font-face { font-family: 'Quicksand'; src: url(data:font/ttf;base64,${arrayBufferToBase64(quicksand)}) format('truetype'); font-display: block; }`,
    `@font-face { font-family: 'Cormorant Garamond'; src: url(data:font/ttf;base64,${arrayBufferToBase64(cormorant)}) format('truetype'); font-display: block; }`,
  ].join("\n");
}

export async function captureReceiptNode(
  node: HTMLElement,
  opts?: { scale?: number; skipFonts?: boolean },
): Promise<ReceiptCapture> {
  const scale = opts?.scale ?? 3.2;
  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }
  await waitForImages(node);
  const rect = node.getBoundingClientRect();
  const width = rect.width || RECEIPT_DOC_WIDTH_PX;
  const height = rect.height || node.scrollHeight;
  const base = {
    pixelRatio: scale,
    backgroundColor: "#ffffff",
    width,
    height,
    cacheBust: true,
  };
  try {
    const fontEmbedCSS = opts?.skipFonts
      ? undefined
      : await buildReceiptFontEmbedCss().catch(() => undefined);
    const dataUrl = await toPng(
      node,
      fontEmbedCSS ? { ...base, fontEmbedCSS } : { ...base, skipFonts: true },
    );
    return { dataUrl, widthPx: Math.round(width * scale), heightPx: Math.round(height * scale) };
  } catch (err) {
    if (!opts?.skipFonts) return captureReceiptNode(node, { scale, skipFonts: true });
    throw err;
  }
}

export async function receiptPdfFromCapture(capture: ReceiptCapture): Promise<Uint8Array> {
  const { pageCount, scale } = computeReceiptPages(capture.widthPx, capture.heightPx);
  const heightPt = capture.heightPx / scale;
  const doc = await PDFDocument.create();
  const base64 = capture.dataUrl.slice(capture.dataUrl.indexOf(",") + 1);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const img = await doc.embedPng(bytes);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([A4_W_PT, A4_H_PT]);
    // Draw the full image shifted down exactly one full page height per page;
    // page bounds crop each slice edge-to-edge, so consecutive pages show
    // contiguous image bands [i*A4_H_PT, (i+1)*A4_H_PT] with no overlap.
    const drawY = A4_H_PT - heightPt + i * A4_H_PT;
    page.drawImage(img, { x: 0, y: drawY, width: A4_W_PT, height: heightPt });
  }
  return doc.save();
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = /data:(.*?)[;,]/.exec(meta)?.[1] || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function receiptFileName(orderNumber: string, lang: string, ext: ReceiptFileFormat): string {
  const safe = (orderNumber || "order").replace(/[^A-Za-z0-9-]/g, "") || "order";
  const langSafe = String(lang || "es").replace(/[^a-z]/gi, "").toLowerCase() || "es";
  return `muy-rico-receipt-${safe}-${langSafe}.${ext}`;
}

export function downloadReceiptFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareReceiptFile(blob: Blob, filename: string): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };
  if (typeof nav.canShare !== "function" || typeof nav.share !== "function") return false;
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  try {
    if (!nav.canShare({ files: [file] })) return false;
    await nav.share({ files: [file], title: filename });
    return true;
  } catch (err) {
    // User cancelled the sheet — treated as handled, not an error.
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return false;
  }
}
