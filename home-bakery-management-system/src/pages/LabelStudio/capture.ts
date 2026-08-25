import { useEffect, useState } from "react";
import type Konva from "konva";
import { ExportError } from "../../utils/labelExport";

export function contentBoxPx(effWIn: number, effHIn: number, pxPerIn: number) {
  return { W: Math.round(effWIn * pxPerIn), H: Math.round(effHIn * pxPerIn) };
}

export function firstFamily(stack: string): string {
  const m = stack.match(/'([^']+)'|"([^"]+)"/);
  return (m?.[1] || m?.[2] || stack.split(",")[0] || "sans-serif").trim();
}

const imgCache = new Map<string, HTMLImageElement>();

export function useHtmlImage(src: string | undefined): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement | undefined>(() =>
    src ? imgCache.get(src) : undefined
  );
  useEffect(() => {
    if (!src) {
      setImg(undefined);
      return;
    }
    const cached = imgCache.get(src);
    if (cached) {
      setImg(cached);
      return;
    }
    let alive = true;
    const im = new window.Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      imgCache.set(src, im);
      if (alive) setImg(im);
    };
    im.onerror = () => {
      if (alive) setImg(undefined);
    };
    im.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return img;
}

const qrCache = new Map<string, string>();

export async function qrDataUrl(value: string): Promise<string> {
  const hit = qrCache.get(value);
  if (hit) return hit;
  const QR = await import("qrcode");
  const url = await QR.toDataURL(value, { margin: 1, width: 256 });
  qrCache.set(value, url);
  return url;
}

export function useQrDataUrl(value: string): string {
  const [url, setUrl] = useState<string>(() => qrCache.get(value) ?? "");
  useEffect(() => {
    let alive = true;
    const hit = qrCache.get(value);
    if (hit) {
      setUrl(hit);
      return;
    }
    qrDataUrl(value)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setUrl("");
      });
    return () => {
      alive = false;
    };
  }, [value]);
  return url;
}

export interface ExportStagePngOptions {
  /** Target resolution in dots per inch (e.g. 300 for print). */
  dpi: number;
  /** Effective label width in inches (drives pixelRatio). */
  effWIn: number;
  /** Output format. */
  format?: "png" | "jpg";
}

/**
 * Capture the stage as a raster image at the requested DPI.
 * Callers hide editor chrome (guides/transformer overlay) around the capture —
 * see StageCanvas.toDataUrl, which wraps this.
 */
export async function exportStagePng(
  stage: Konva.Stage,
  opts: ExportStagePngOptions
): Promise<{ dataUrl: string; widthPx: number }> {
  const { dpi, effWIn, format = "png" } = opts;
  try {
    const stageW = stage.width();
    if (!stageW || stageW <= 0) throw new Error("stage has no width");
    // Wait for webfonts so text rasterizes with the final typefaces.
    if (typeof document !== "undefined" && document.fonts?.ready) {
      await document.fonts.ready;
    }
    const pixelRatio = (effWIn * dpi) / stageW;
    const dataUrl = stage.toDataURL({
      pixelRatio,
      mimeType: format === "jpg" ? "image/jpeg" : "image/png",
      quality: format === "jpg" ? 0.95 : undefined,
    });
    return { dataUrl, widthPx: Math.round(effWIn * dpi) };
  } catch (err) {
    console.warn("labelExport: stage capture failed:", err);
    throw new ExportError("Could not capture the label image for export.", err);
  }
}
