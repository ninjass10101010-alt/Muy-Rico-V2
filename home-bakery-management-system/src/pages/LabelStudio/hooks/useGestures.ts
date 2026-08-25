import { useEffect } from "react";
import type { RefObject } from "react";
import type Konva from "konva";
import { useEditorStore } from "../state";

interface Pt {
  x: number;
  y: number;
}

interface PinchState {
  kind: "pinch";
  pointerIds: number[];
  startDist: number;
  startZoom: number;
  startPan: Pt;
}

interface PanState {
  kind: "pan";
  pointerId: number;
  startPos: Pt;
  startPan: Pt;
}

type Gesture = PinchState | PanState;

const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const WHEEL_SENSITIVITY = 0.0025;

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Pinch / pan / ctrl-wheel viewport gestures for the label Stage.
 *
 * Attaches native listeners to the Stage CONTAINER div:
 * - two pointers anywhere -> pinch zoom anchored at the pinch midpoint
 * - one pointer starting on empty stage -> pan
 * - ctrl/meta + wheel -> zoom about cursor (preventDefault); plain wheel untouched
 *
 * All store reads happen via getState() inside handlers; only Stage-transform
 * writes (setZoom/setPan) occur, so no React re-renders are triggered per frame.
 */
export function useGestures(
  stageRef: RefObject<Konva.Stage | null>,
  containerRef: RefObject<HTMLDivElement | null>
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.style.touchAction = "none";

    const pointers = new Map<number, Pt>();
    let gesture: Gesture | null = null;
    let trackingWindow = false;

    const relPos = (e: PointerEvent | WheelEvent): Pt => {
      const rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    /** Zoom anchored at focal point: pan' = f - (f - pan) * k. */
    const zoomAnchoredAt = (rawZoom: number, focal: Pt): void => {
      const before = useEditorStore.getState();
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, rawZoom));
      before.setZoom(clamped);
      const applied = useEditorStore.getState().zoom;
      if (applied === before.zoom) return;
      const k = applied / before.zoom;
      before.setPan(focal.x - (focal.x - before.panX) * k, focal.y - (focal.y - before.panY) * k);
    };

    const beginPinch = (): void => {
      const entries = [...pointers.entries()];
      if (entries.length < 2) return;
      const [a, b] = [entries[0][1], entries[1][1]];
      const st = useEditorStore.getState();
      gesture = {
        kind: "pinch",
        pointerIds: [entries[0][0], entries[1][0]],
        startDist: Math.max(1, dist(a, b)),
        startZoom: st.zoom,
        startPan: { x: st.panX, y: st.panY },
      };
    };

    const applyPinch = (): void => {
      if (!gesture || gesture.kind !== "pinch") return;
      const p1 = pointers.get(gesture.pointerIds[0]);
      const p2 = pointers.get(gesture.pointerIds[1]);
      if (!p1 || !p2) return;
      const k = dist(p1, p2) / gesture.startDist;
      const mid: Pt = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      // Focal anchoring relative to the pinch-start frame keeps the midpoint stable.
      const st = useEditorStore.getState();
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, gesture.startZoom * k));
      st.setZoom(clamped);
      const applied = useEditorStore.getState().zoom;
      if (applied === gesture.startZoom) return;
      const kk = applied / gesture.startZoom;
      st.setPan(
        mid.x - (mid.x - gesture.startPan.x) * kk,
        mid.y - (mid.y - gesture.startPan.y) * kk
      );
    };

    const onPointerDown = (e: PointerEvent): void => {
      const p = relPos(e);
      pointers.set(e.pointerId, p);

      if (pointers.size === 2) {
        beginPinch();
        attachWindowTracking();
        return;
      }

      if (pointers.size === 1) {
        const stage = stageRef.current;
        const hitShape = stage ? stage.getIntersection(p) : null;
        if (!hitShape) {
          const st = useEditorStore.getState();
          gesture = {
            kind: "pan",
            pointerId: e.pointerId,
            startPos: p,
            startPan: { x: st.panX, y: st.panY },
          };
        } else {
          gesture = null; // element press: Konva handles drag/select
        }
        attachWindowTracking();
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, relPos(e));

      if (pointers.size >= 2) {
        applyPinch();
        return;
      }

      if (gesture && gesture.kind === "pan" && gesture.pointerId === e.pointerId) {
        const cur = pointers.get(e.pointerId)!;
        const st = useEditorStore.getState();
        st.setPan(gesture.startPan.x + (cur.x - gesture.startPos.x), gesture.startPan.y + (cur.y - gesture.startPos.y));
      }
    };

    const onPointerEnd = (e: PointerEvent): void => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size < 2 && gesture && gesture.kind === "pinch") gesture = null;
      if (gesture && gesture.kind === "pan" && gesture.pointerId === e.pointerId) gesture = null;
      if (pointers.size === 0) detachWindowTracking();
    };

    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel scrolls the page normally
      e.preventDefault();
      zoomAnchoredAt(useEditorStore.getState().zoom * Math.exp(-e.deltaY * WHEEL_SENSITIVITY), relPos(e));
    };

    const onWindowMove = (e: PointerEvent): void => onPointerMove(e);
    const onWindowEnd = (e: PointerEvent): void => onPointerEnd(e);

    function attachWindowTracking(): void {
      if (trackingWindow) return;
      trackingWindow = true;
      window.addEventListener("pointermove", onWindowMove);
      window.addEventListener("pointerup", onWindowEnd);
      window.addEventListener("pointercancel", onWindowEnd);
    }

    function detachWindowTracking(): void {
      if (!trackingWindow) return;
      trackingWindow = false;
      window.removeEventListener("pointermove", onWindowMove);
      window.removeEventListener("pointerup", onWindowEnd);
      window.removeEventListener("pointercancel", onWindowEnd);
    }

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      detachWindowTracking();
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("wheel", onWheel);
      pointers.clear();
      gesture = null;
    };
  }, [stageRef, containerRef]);
}
