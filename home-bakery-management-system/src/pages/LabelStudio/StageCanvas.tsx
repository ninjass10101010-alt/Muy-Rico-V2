import { useCallback, useMemo, useRef } from "react";
import type Konva from "konva";
import type { SceneContext } from "konva/lib/Context";
import { Ellipse, Group, Image as KImage, Layer, Rect, Stage } from "react-konva";
import { useShallow } from "zustand/react/shallow";
import type { BusinessProfile, LabelShape, LabelTemplate } from "../../types";
import { effectiveDimensions } from "../../components/label/defaultElements";
import { formatBestBy, resolveBestBy } from "./labelMath";
import { selectSortedElements, useEditorStore } from "./state";
import { contentBoxPx, useHtmlImage } from "./capture";
import ElementNode from "./elements/ElementNode";

export { contentBoxPx };

const PX_PER_IN_BASE = 96;

interface FrameGeom {
  pad: number;
  outer: { x: number; y: number; w: number; h: number };
  radius: number;
  isCurved: boolean;
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

export default function StageCanvas({
  baseScale,
  profile,
}: {
  baseScale: number;
  profile: BusinessProfile;
}) {
  const doc = useEditorStore((s) => s.doc);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const selection = useEditorStore((s) => s.selection);
  const editingId = useEditorStore((s) => s.editingId);
  const select = useEditorStore((s) => s.select);
  const sorted = useEditorStore(useShallow(selectSortedElements));
  const refs = useRef<Map<string, Konva.Node>>(new Map());
  const registerRef = useCallback((id: string, node: unknown | null) => {
    if (node) refs.current.set(id, node as Konva.Node);
    else refs.current.delete(id);
  }, []);
  const bestByStr = useMemo(() => formatBestBy(resolveBestBy(doc)), [doc]);

  const { effW, effH } = effectiveDimensions(
    doc.labelWidth,
    doc.labelHeight,
    doc.shape,
    doc.orientation || "portrait"
  );
  const pxPerIn = PX_PER_IN_BASE * baseScale * (zoom / 100);
  const dims = contentBoxPx(effW, effH, pxPerIn);
  const W = Number.isFinite(dims.W) && dims.W > 0 ? dims.W : 288;
  const H = Number.isFinite(dims.H) && dims.H > 0 ? dims.H : 384;

  return (
    <Stage
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
            />
          )
        )}
      </Layer>
      <Layer />
    </Stage>
  );
}
