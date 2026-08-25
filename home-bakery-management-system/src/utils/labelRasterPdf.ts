/**
 * Raster-exact label PDF export.
 * Takes a PNG data URL captured from the Konva stage and embeds it ONCE into a
 * pdf-lib document — the image pixels are byte-identical to the on-screen
 * canvas preview (the "exact preview" fidelity path).
 */
import { PDFDocument } from "pdf-lib";
import { AVERY_LAYOUTS, ExportError } from "./labelExport";
import type { AveryLayout } from "./labelExport";

const PT_PER_IN = 72;

/**
 * Cell geometry for a sheet preset, mirroring the vector path's square-shape
 * handling in `renderLabelPdf`: square/circle labels use
 * min(layout.labelW, layout.labelH) for both cell axes AND the row pitch so a
 * square label never stretches into a rectangular cell.
 * Callers pass effective dims (orientation/square already resolved), so
 * squareness is inferred from equal effective width/height.
 */
export function rasterCellGeom(
  layout: AveryLayout,
  eff: { effWIn: number; effHIn: number }
): { cellW: number; cellH: number } {
  const isSquare = Math.abs(eff.effWIn - eff.effHIn) < 0.01;
  if (isSquare) {
    const s = Math.min(layout.labelW, layout.labelH);
    return { cellW: s, cellH: s };
  }
  return { cellW: layout.labelW, cellH: layout.labelH };
}

export interface RasterPdfOptions {
  /** Effective label width in inches (already orientation/square-adjusted). */
  effWIn: number;
  /** Effective label height in inches (already orientation/square-adjusted). */
  effHIn: number;
  /** Sheet preset; "single" sizes the page to the label itself. */
  sheet?: "single" | "5164" | "5163" | "8163";
  /** Number of copies for sheet presets; defaults to cols×rows. */
  copies?: number;
}

/**
 * Render a raster PDF from a PNG data URL.
 * Geometry mirrors `renderLabelPdf`'s sheet branch: sheet presets use the
 * AVERY layout offsets on Letter pages; single = page sized to the label.
 */
export async function renderRasterPdf(
  dataUrl: string,
  opts: RasterPdfOptions
): Promise<Uint8Array> {
  const { effWIn, effHIn, sheet = "single", copies } = opts;
  if (!effWIn || !effHIn || effWIn <= 0 || effHIn <= 0) {
    throw new ExportError("Invalid label dimensions for PDF export.");
  }
  // Unknown presets degrade to a single-label page (never a blank sheet).
  const effSheet = Object.prototype.hasOwnProperty.call(AVERY_LAYOUTS, sheet) ? sheet : "single";
  const layout = AVERY_LAYOUTS[effSheet];

  // Label size: sheet presets dictate cell size (square labels collapse to
  // min(labelW,labelH)); single uses the effective label dimensions
  // (orientation/square swap already applied by the caller).
  const { cellW, cellH } =
    effSheet !== "single"
      ? rasterCellGeom(layout, { effWIn, effHIn })
      : { cellW: effWIn, cellH: effHIn };
  const labelWPt = cellW * PT_PER_IN;
  const labelHPt = cellH * PT_PER_IN;

  const doc = await PDFDocument.create();
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    // Embedded ONCE; every copy on the sheet references the same XObject.
    const img = await doc.embedPng(bytes);

    if (effSheet === "single") {
      const page = doc.addPage([labelWPt, labelHPt]);
      page.drawImage(img, { x: 0, y: 0, width: labelWPt, height: labelHPt });
    } else {
      const sheetW = 8.5 * PT_PER_IN;
      const sheetH = 11 * PT_PER_IN;
      const count = copies ?? layout.cols * layout.rows;
      const perPage = layout.cols * layout.rows;
      const pages = Math.ceil(count / perPage) || 1;
      let copy = 0;
      for (let p = 0; p < pages; p++) {
        const page = doc.addPage([sheetW, sheetH]);
        for (let r = 0; r < layout.rows; r++) {
          for (let c = 0; c < layout.cols; c++) {
            if (copy >= count) break;
            const ox = (layout.marginLeft + c * (layout.labelW + layout.gapH)) * PT_PER_IN;
            const oy =
              (sheetH / PT_PER_IN - layout.marginTop - (r + 1) * cellH - r * layout.gapV) *
              PT_PER_IN;
            page.drawImage(img, { x: ox, y: oy, width: labelWPt, height: labelHPt });
            copy++;
          }
        }
      }
    }

    return await doc.save();
  } catch (err) {
    if (err instanceof ExportError) throw err;
    throw new ExportError("Could not build the PDF from the captured label image.", err);
  }
}
