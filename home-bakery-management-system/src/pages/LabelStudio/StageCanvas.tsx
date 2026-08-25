import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import type { SceneContext } from "konva/lib/Context";
import { Ellipse, Group, Image as KImage, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import { useShallow } from "zustand/react/shallow";
import type { BusinessProfile, LabelShape, LabelTemplate } from "../../types";
import { clamp01, effectiveDimensions } from "../../components/label/defaultElements";
import { computeSnap, formatBestBy, resolveBestBy } from "./labelMath";
import type { Rect as SnapRect } from "./labelMath";
import { selectSortedElements, useEditorStore } from "./state";
import { contentBoxPx, exportStagePng, useHtmlImage } from "./capture";
import ElementNode from "./elements/ElementNode";
import InlineTextEdit, { isInlineEditable } from "./InlineTextEdit";
import { useGestures } from "./hooks/useGestures";

export { contentBoxPx };

/** Imperative capture API exposed by the stage (used by the Export popover). */
export interface StageCanvasHandle {
  toDataUrl(opts: {
    dpi: number;
    effWIn: number;
    format?: "png" | "jpg";
  }): Promise<{ dataUrl: string; widthPx: number }>;
}

const PX_PER_IN_BASE = 96;
const SNAP_PX = 8;
const GUIDE_COLOR = "#f43f5e";
const MIN_BOX_PX = 24;
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

interface FrameGeom {
  pad: number;
  outer: { x: number; y: number; w: number; h: number };
  radius: number;
  isCurved: boolean;
}

interface Guides {
  guidesX: number[];
  guidesY: number[];
}

const EMPTY_GUIDES: Guides = { guidesX: [], guidesY: [] };

function sameGuides(a: Guides, bx: number[], by: number[]): boolean {
  return (
    a.guidesX.length === bx.length &&
    a.guidesY.length === by.length &&
    a.guidesX.every((v, i) => v === bx[i]) &&
    a.guidesY.every((v, i) => v === by[i])
  );
}

/** Content box in stage px — recomputable inside getState()-based handlers. */
function contentDims(doc: LabelTemplate, baseScale: number): { W: number; H: number } {
  const zoom = useEditorStore.getState().zoom;
  const { effW, effH } = effectiveDimensions(
    doc.labelWidth,
    doc.labelHeight,
    doc.shape,
    doc.orientation || "portrait"
  );
  const pxPerIn = PX_PER_IN_BASE * baseScale * (zoom / 100);
  const dims = contentBoxPx(effW, effH, pxPerIn);
  return {
    W: Number.isFinite(dims.W) && dims.W > 0 ? dims.W : 288,
    H: Number.isFinite(dims.H) && dims.H > 0 ? dims.H : 384,
  };
}

export function frameGeometry(
  W: number,
  H: number,
  shape: LabelShape,
  unit: number
): FrameGeom {
  const isCurved = shape === "circle" || shape === "oval";
  const pad = (isCurved ? 0.06 : 0.03) * W;
  const outer = { x: -pad, y: -pad, w: W + pad * 2, h: H + pad * 2 };
  const radius =
    shape === "circle"
      ? outer.w / 2
      : shape === "square"
        ? 8 * unit
        : shape === "rounded"
          ? 12 * unit
          : 0;
  return { pad, outer, radius, isCurved };
}

function roundRectPath(
  ctx: SceneContext,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function BackgroundFrame({
  doc,
  W,
  H,
  pxPerIn,
}: {
  doc: LabelTemplate;
  W: number;
  H: number;
  pxPerIn: number;
}) {
  const unit = pxPerIn / PX_PER_IN_BASE;
  const geom = frameGeometry(W, H, doc.shape, unit);
  const bw = 4 * unit;
  const bgImg = useHtmlImage(doc.bgImage);

  let cover: { x: number; y: number; w: number; h: number } | null = null;
  if (bgImg && bgImg.naturalWidth > 0 && bgImg.naturalHeight > 0) {
    const s = Math.max(geom.outer.w / bgImg.naturalWidth, geom.outer.h / bgImg.naturalHeight);
    cover = {
      x: geom.outer.x + (geom.outer.w - bgImg.naturalWidth * s) / 2,
      y: geom.outer.y + (geom.outer.h - bgImg.naturalHeight * s) / 2,
      w: bgImg.naturalWidth * s,
      h: bgImg.naturalHeight * s,
    };
  }

  const cx = geom.outer.x + geom.outer.w / 2;
  const cy = geom.outer.y + geom.outer.h / 2;

  return (
    <>
      <Group
        clipFunc={(ctx: SceneContext) => {
          ctx.beginPath();
          if (geom.isCurved) {
            ctx.ellipse(cx, cy, geom.outer.w / 2, geom.outer.h / 2, 0, 0, Math.PI * 2);
          } else {
            roundRectPath(ctx, geom.outer.x, geom.outer.y, geom.outer.w, geom.outer.h, geom.radius);
          }
        }}
      >
        <Rect
          x={geom.outer.x}
          y={geom.outer.y}
          width={geom.outer.w}
          height={geom.outer.h}
          fill={doc.bgColor}
        />
        {cover && bgImg && (
          <KImage image={bgImg} x={cover.x} y={cover.y} width={cover.w} height={cover.h} />
        )}
      </Group>
      {doc.shape === "oval" ? (
        <Ellipse
          x={cx}
          y={cy}
          radiusX={(geom.outer.w - bw) / 2}
          radiusY={(geom.outer.h - bw) / 2}
          stroke={doc.accentColor}
          strokeWidth={bw}
        />
      ) : (
        <Rect
          x={geom.outer.x + bw / 2}
          y={geom.outer.y + bw / 2}
          width={geom.outer.w - bw}
          height={geom.outer.h - bw}
          cornerRadius={Math.max(0, geom.radius - bw / 2)}
          stroke={doc.accentColor}
          strokeWidth={bw}
        />
      )}
    </>
  );
}

const StageCanvas = forwardRef<StageCanvasHandle, { baseScale: number; profile: BusinessProfile }>(
  function StageCanvas({ baseScale, profile }, ref) {
  const doc = useEditorStore((s) => s.doc);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const selection = useEditorStore((s) => s.selection);
  const editingId = useEditorStore((s) => s.editingId);
  const editingEl = useEditorStore((s) =>
    s.editingId ? s.doc.elements.find((e) => e.id === s.editingId) || null : null
  );
  const select = useEditorStore((s) => s.select);
  const sorted = useEditorStore(useShallow(selectSortedElements));
  const selectedEl = useEditorStore((s) =>
    s.selection ? s.doc.elements.find((e) => e.id === s.selection) || null : null
  );
  const refs = useRef<Map<string, Konva.Node>>(new Map());
  const registerRef = useCallback((id: string, node: unknown | null) => {
    if (node) refs.current.set(id, node as Konva.Node);
    else refs.current.delete(id);
  }, []);
  const bestByStr = useMemo(() => formatBestBy(resolveBestBy(doc)), [doc]);

  const stageRef = useRef<Konva.Stage>(null);
  const overlayLayerRef = useRef<Konva.Layer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const trRef = useRef<Konva.Transformer>(null);
  // Latest baseScale for getState()-based gesture handlers (stable closures).
  const baseScaleRef = useRef(baseScale);

  useEffect(() => {
    baseScaleRef.current = baseScale;
  }, [baseScale]);

  useGestures(stageRef, containerRef);

  // Export capture API: hide editor chrome (guides + transformer overlay),
  // rasterize at the requested DPI, then restore the overlay.
  useImperativeHandle(ref, () => ({
    toDataUrl: async (opts) => {
      const stage = stageRef.current;
      if (!stage) throw new Error("Stage is not mounted");
      const overlay = overlayLayerRef.current;
      if (overlay) {
        overlay.visible(false);
        stage.draw();
      }
      try {
        return await exportStagePng(stage, opts);
      } finally {
        if (overlay) {
          overlay.visible(true);
          stage.draw();
        }
      }
    },
  }), []);

  const [guides, setGuides] = useState<Guides>(EMPTY_GUIDES);

  const pxPerIn = PX_PER_IN_BASE * baseScale * (zoom / 100);
  const { effW, effH } = effectiveDimensions(
    doc.labelWidth,
    doc.labelHeight,
    doc.shape,
    doc.orientation || "portrait"
  );
  const dims = contentBoxPx(effW, effH, pxPerIn);
  const W = Number.isFinite(dims.W) && dims.W > 0 ? dims.W : 288;
  const H = Number.isFinite(dims.H) && dims.H > 0 ? dims.H : 384;

  // --- Stable gesture handlers: read fresh state via getState(), mutate Konva
  // nodes directly during gestures, commit ONE patchElement per gesture end.

  const onSelectEl = useCallback((id: string) => {
    useEditorStore.getState().select(id);
  }, []);

  const onEditStartEl = useCallback((id: string) => {
    const st = useEditorStore.getState();
    const el = st.doc.elements.find((e) => e.id === id);
    if (el && isInlineEditable(el)) st.setEditingId(id);
  }, []);

  const onDragStartEl = useCallback((_id: string) => {
    setGuides(EMPTY_GUIDES);
  }, []);

  const onDragMoveEl = useCallback((id: string, node: Konva.Node) => {
    const st = useEditorStore.getState();
    const me = st.doc.elements.find((e) => e.id === id);
    if (!me) return;
    const { W: cw, H: ch } = contentDims(st.doc, baseScaleRef.current);
    const others: SnapRect[] = st.doc.elements
      .filter((e) => e.id !== id && !e.hidden)
      .sort((a, b) => a.z - b.z)
      .map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
    // node position is the box CENTER (center-pivot offsets); derive top-left rect.
    const moving: SnapRect = {
      x: (node.x() - (me.w * cw) / 2) / cw,
      y: (node.y() - (me.h * ch) / 2) / ch,
      w: me.w,
      h: me.h,
    };
    const snapX = computeSnap(moving, others, SNAP_PX / cw);
    const snapY = computeSnap(moving, others, SNAP_PX / ch);
    if (snapX.dx !== 0) node.x(node.x() + snapX.dx * cw);
    if (snapY.dy !== 0) node.y(node.y() + snapY.dy * ch);
    setGuides((prev) =>
      sameGuides(prev, snapX.guidesX, snapY.guidesY)
        ? prev
        : { guidesX: snapX.guidesX, guidesY: snapY.guidesY }
    );
  }, []);

  const onDragEndEl = useCallback((id: string, node: Konva.Node) => {
    const st = useEditorStore.getState();
    const me = st.doc.elements.find((e) => e.id === id);
    if (!me) return;
    const { W: cw, H: ch } = contentDims(st.doc, baseScaleRef.current);
    const nx = clamp01((node.x() - (me.w * cw) / 2) / cw);
    const ny = clamp01((node.y() - (me.h * ch) / 2) / ch);
    setGuides(EMPTY_GUIDES);
    st.patchElement(id, { x: nx, y: ny });
  }, []);

  const onTransformEndEl = useCallback((id: string, node: Konva.Node) => {
    const st = useEditorStore.getState();
    const me = st.doc.elements.find((e) => e.id === id);
    if (!me) return;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scale({ x: 1, y: 1 });
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || Math.abs(sx) < 0.02 || Math.abs(sy) < 0.02) {
      return;
    }
    const { W: cw, H: ch } = contentDims(st.doc, baseScaleRef.current);
    const lw = me.w * cw * sx;
    const lh = me.h * ch * sy;
    const nw = Math.min(1, lw / cw);
    const nh = Math.min(1, lh / ch);
    const center = node.position(); // box center in layer coords (rotation-invariant)
    const rotation = ((Math.round(node.rotation()) % 360) + 360) % 360;
    st.patchElement(id, {
      x: clamp01((center.x - lw / 2) / cw),
      y: clamp01((center.y - lh / 2) / ch),
      w: nw,
      h: nh,
      rotation,
    });
  }, []);

  // Attach/detach the single Transformer on selection changes.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node =
      selection && selectedEl && !selectedEl.lock && !selectedEl.hidden
        ? refs.current.get(selection)
        : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
    return () => {
      tr.nodes([]);
    };
  }, [selection, selectedEl, refs]);

  const keepRatio = selectedEl?.type === "logo" || selectedEl?.type === "qr";

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <div ref={containerRef} style={{ touchAction: "none" }}>
        <Stage
          ref={stageRef}
          width={W}
          height={H}
          scaleX={1}
          scaleY={1}
          x={panX}
          y={panY}
          onMouseDown={(e) => {
            if (e.target === e.target.getStage()) select(null);
          }}
          onTouchStart={(e) => {
            if (e.target === e.target.getStage()) select(null);
          }}
        >
          <Layer listening={false}>
            <BackgroundFrame doc={doc} W={W} H={H} pxPerIn={pxPerIn} />
          </Layer>
          <Layer>
            {sorted.map((el) =>
              el.hidden ? null : (
                <ElementNode
                  key={el.id}
                  el={el}
                  label={doc}
                  profile={profile}
                  W={W}
                  H={H}
                  selected={selection === el.id}
                  editing={editingId === el.id}
                  bestByStr={bestByStr}
                  registerRef={registerRef}
                  onSelectEl={onSelectEl}
                  onEditStartEl={onEditStartEl}
                  onDragStartEl={onDragStartEl}
                  onDragMoveEl={onDragMoveEl}
                  onDragEndEl={onDragEndEl}
                  onTransformEndEl={onTransformEndEl}
                />
              )
            )}
          </Layer>
          <Layer ref={overlayLayerRef}>
            {guides.guidesX.map((gx, i) => (
              <Line
                key={`gx-${i}`}
                points={[gx * W, 0, gx * W, H]}
                stroke={GUIDE_COLOR}
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            ))}
            {guides.guidesY.map((gy, i) => (
              <Line
                key={`gy-${i}`}
                points={[0, gy * H, W, gy * H]}
                stroke={GUIDE_COLOR}
                strokeWidth={1}
                dash={[4, 4]}
                listening={false}
              />
            ))}
            <Transformer
              ref={trRef}
              rotateEnabled
              rotationSnaps={ROTATION_SNAPS}
              rotationSnapTolerance={4}
              keepRatio={keepRatio}
              anchorSize={12}
              anchorCornerRadius={3}
              borderStroke={GUIDE_COLOR}
              rotateAnchorOffset={24}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < MIN_BOX_PX || newBox.height < MIN_BOX_PX ? oldBox : newBox
              }
            />
          </Layer>
        </Stage>
      </div>
      {editingEl && !editingEl.hidden && (
        <InlineTextEdit
          key={editingEl.id}
          el={editingEl}
          label={doc}
          profile={profile}
          W={W}
          H={H}
          panX={panX}
          panY={panY}
          bestByStr={bestByStr}
          containerRef={containerRef}
          wrapperRef={wrapperRef}
        />
      )}
    </div>
  );
});

export default StageCanvas;
