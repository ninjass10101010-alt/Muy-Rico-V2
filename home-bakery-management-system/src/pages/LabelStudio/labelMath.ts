// Text resolution and NFP rows live in dependency-free utils modules so the
// PDF export path (src/utils) can share them without a utils→pages import.
export { resolveBestBy, formatBestBy, effectiveText } from "../../utils/labelText";
export { NFP_ROWS, dvPercent } from "../../utils/nfpRows";
export type { NfpRow } from "../../utils/nfpRows";

export interface Rect { x: number; y: number; w: number; h: number }

/** Greedy word wrap. `measure(line)` returns rendered width; caller supplies metrics. */
export function wrapLines(
  text: string,
  measure: (line: string) => number,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (measure(candidate) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Snap `moving` rect against sibling rects + canvas edges/center.
 * Returns pixel deltas to apply and guide positions (normalized) that fired.
 */
export function computeSnap(
  moving: Rect,
  others: Rect[],
  threshold: number
): { dx: number; dy: number; guidesX: number[]; guidesY: number[] } {
  const xs: number[] = [0, 0.5, 1];
  const ys: number[] = [0, 0.5, 1];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  const mLeft = moving.x, mCenterX = moving.x + moving.w / 2, mRight = moving.x + moving.w;
  const mTop = moving.y, mCenterY = moving.y + moving.h / 2, mBottom = moving.y + moving.h;

  let dx = 0, dy = 0;
  const guidesX: number[] = [], guidesY: number[] = [];
  let bestDx = threshold, bestDy = threshold;

  for (const t of xs) {
    for (const mEdge of [mLeft, mCenterX, mRight]) {
      const delta = t - mEdge;
      if (Math.abs(delta) < bestDx) { bestDx = Math.abs(delta); dx = delta; guidesX.length = 0; guidesX.push(t); }
    }
  }
  for (const t of ys) {
    for (const mEdge of [mTop, mCenterY, mBottom]) {
      const delta = t - mEdge;
      if (Math.abs(delta) < bestDy) { bestDy = Math.abs(delta); dy = delta; guidesY.length = 0; guidesY.push(t); }
    }
  }
  if (guidesX.length === 0) dx = 0;
  if (guidesY.length === 0) dy = 0;
  return { dx, dy, guidesX, guidesY };
}
