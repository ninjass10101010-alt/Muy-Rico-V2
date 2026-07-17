import { useCallback, useRef } from "react";
import type { LabelElement } from "../../types";
import { clamp01 } from "./defaultElements";

type Handle =
  | "move"
  | "n"
  | "s"
  | "e"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw"
  | "rotate";

interface DragState {
  handle: Handle;
  elId: string;
  startX: number;
  startY: number;
  orig: LabelElement;
  containerW: number;
  containerH: number;
  centerX: number;
  centerY: number;
  startAngle: number;
}

const MIN_SIZE = 0.06;
const GRID_STEP = 0.05;

function snap(v: number, step: number = GRID_STEP): number {
  return Math.round(v / step) * step;
}

function snap15(deg: number): number {
  return Math.round(deg / 15) * 15;
}

export function useElementDrag(
  elements: LabelElement[],
  onChange: (next: LabelElement[]) => void,
  containerRef: React.RefObject<HTMLElement | null>
) {
  const dragRef = useRef<DragState | null>(null);

  const updateElement = useCallback(
    (id: string, patch: Partial<LabelElement>) => {
      onChange(elements.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    },
    [elements, onChange]
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent, el: LabelElement, handle: Handle) => {
      if (el.lock) return;
      e.preventDefault();
      e.stopPropagation();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + (el.x + el.w / 2) * rect.width;
      const centerY = rect.top + (el.y + el.h / 2) * rect.height;
      const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

      dragRef.current = {
        handle,
        elId: el.id,
        startX: e.clientX,
        startY: e.clientY,
        orig: { ...el },
        containerW: rect.width,
        containerH: rect.height,
        centerX,
        centerY,
        startAngle,
      };
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [containerRef]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (e.clientX - d.startX) / d.containerW;
      const dy = (e.clientY - d.startY) / d.containerH;
      const o = d.orig;
      let next: Partial<LabelElement> = {};

      if (d.handle === "move") {
        const lockX = e.shiftKey;
        const lockY = e.shiftKey && Math.abs(dx) > Math.abs(dy);
        const rawX = clamp01(o.x + (lockY ? 0 : dx));
        const rawY = clamp01(o.y + (lockX && !lockY ? 0 : dy));
        next = {
          x: e.shiftKey ? rawX : snap(rawX),
          y: e.shiftKey ? rawY : snap(rawY),
        };
        // Keep fully on canvas
        next.x = Math.min(next.x!, 1 - o.w);
        next.y = Math.min(next.y!, 1 - o.h);
        next.x = Math.max(0, next.x!);
        next.y = Math.max(0, next.y!);
      } else if (d.handle === "rotate") {
        const angle = Math.atan2(e.clientY - d.centerY, e.clientX - d.centerX);
        let deg = ((angle - d.startAngle) * 180) / Math.PI + (o.rotation || 0);
        if (e.shiftKey) deg = snap15(deg);
        next = { rotation: ((deg % 360) + 360) % 360 };
      } else {
        let { x, y, w, h } = o;
        const preserve = d.handle.length === 2; // corner
        if (d.handle.includes("e")) w = o.w + dx;
        if (d.handle.includes("w")) {
          w = o.w - dx;
          x = o.x + dx;
        }
        if (d.handle.includes("s")) h = o.h + dy;
        if (d.handle.includes("n")) {
          h = o.h - dy;
          y = o.y + dy;
        }
        if (preserve && (o.type === "logo" || o.type === "qr")) {
          const aspect = o.w / o.h || 1;
          if (Math.abs(dx) > Math.abs(dy)) h = w / aspect;
          else w = h * aspect;
        }
        w = Math.max(MIN_SIZE, w);
        h = Math.max(MIN_SIZE, h);
        x = clamp01(x);
        y = clamp01(y);
        if (x + w > 1) w = 1 - x;
        if (y + h > 1) h = 1 - y;
        if (!e.shiftKey) {
          x = snap(x);
          y = snap(y);
          w = snap(w);
          h = snap(h);
        }
        next = { x, y, w, h };
      }
      updateElement(d.elId, next);
    },
    [updateElement]
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, updateElement };
}
