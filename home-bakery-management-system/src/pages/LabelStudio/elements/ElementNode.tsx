import type Konva from "konva";
import type { SceneContext } from "konva/lib/Context";
import { Ellipse, Group, Image as KImage, Line, Rect, Text } from "react-konva";
import { memo } from "react";
import type { ReactNode } from "react";
import type { BusinessProfile, LabelElement, LabelTemplate, NfpData } from "../../../types";
import { NFP_ROWS, dvPercent, effectiveText, wrapLines } from "../labelMath";
import { firstFamily, useHtmlImage, useQrDataUrl } from "../capture";

export { firstFamily };

interface Props {
  el: LabelElement;
  label: LabelTemplate;
  profile: BusinessProfile;
  W: number;
  H: number;
  selected: boolean;
  editing: boolean;
  bestByStr: string;
  registerRef: (id: string, node: unknown | null) => void;
  onSelectEl?: (id: string) => void;
  onEditStartEl?: (id: string) => void;
  onDragStartEl?: (id: string, node: Konva.Node) => void;
  onDragMoveEl?: (id: string, node: Konva.Node) => void;
  onDragEndEl?: (id: string, node: Konva.Node) => void;
  onTransformEndEl?: (id: string, node: Konva.Node) => void;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

function textMeasurer(font: string): (line: string) => number {
  if (measureCtx === undefined) {
    measureCtx =
      typeof document !== "undefined"
        ? document.createElement("canvas").getContext("2d")
        : null;
  }
  const ctx = measureCtx;
  return (line: string) => {
    if (!ctx) return line.length * 8;
    ctx.font = font;
    return ctx.measureText(line).width;
  };
}

function fontStyleOf(el: LabelElement): string {
  const parts: string[] = [];
  if (el.italic) parts.push("italic");
  if (el.bold) parts.push("bold");
  return parts.length > 0 ? parts.join(" ") : "normal";
}

function TextNode({
  el,
  label,
  W,
  text,
}: {
  el: LabelElement;
  label: LabelTemplate;
  W: number;
  text: string;
}) {
  const boxW = el.w * W;
  const fontSizePx = ((el.fontSizeOverride ?? 4) / 100) * W;
  const family = firstFamily(el.fontFamilyOverride || label.font);
  const weight = el.bold ? 700 : 400;
  const italicPrefix = el.italic ? "italic " : "";
  const measureFont = `${italicPrefix}${weight} ${fontSizePx}px ${family}`;
  const wrapped = wrapLines(text, textMeasurer(measureFont), boxW);
  return (
    <Text
      text={wrapped.join("\n")}
      width={boxW}
      fontSize={fontSizePx}
      fontFamily={family}
      fontStyle={fontStyleOf(el)}
      textDecoration={el.underline ? "underline" : undefined}
      fill={el.colorOverride || label.textColor}
      align={el.alignOverride || "center"}
      lineHeight={1.2}
      wrap="none"
    />
  );
}

function LogoNode({
  label,
  W,
  boxW,
  boxH,
}: {
  label: LabelTemplate;
  W: number;
  boxW: number;
  boxH: number;
}) {
  const img = useHtmlImage(label.logoImage);
  if (label.logoImage && img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const ratio = Math.min(boxW / img.naturalWidth, boxH / img.naturalHeight);
    const w = img.naturalWidth * ratio;
    const h = img.naturalHeight * ratio;
    return <KImage image={img} x={(boxW - w) / 2} y={(boxH - h) / 2} width={w} height={h} />;
  }
  if (label.logoImage) return null;
  return (
    <Text
      text={label.logoEmoji || ""}
      width={boxW}
      height={boxH}
      align="center"
      verticalAlign="middle"
      fontSize={((label.logoSize ?? 16) / 100) * W}
      lineHeight={1}
      fontFamily={firstFamily(label.font)}
      fill={label.textColor}
    />
  );
}

function QrNode({
  el,
  label,
  profile,
  boxW,
  boxH,
}: {
  el: LabelElement;
  label: LabelTemplate;
  profile: BusinessProfile;
  boxW: number;
  boxH: number;
}) {
  const value = el.qrValue || label.websiteUrl || profile.website || "https://muy-rico.com";
  const url = useQrDataUrl(value);
  const img = useHtmlImage(url || undefined);
  const pad = boxW * 0.04;
  const side = Math.max(0, Math.min(boxW, boxH) - pad * 2);
  return (
    <>
      <Rect width={boxW} height={boxH} fill="#ffffff" />
      {img && (
        <KImage
          image={img}
          x={(boxW - side) / 2}
          y={(boxH - side) / 2}
          width={side}
          height={side}
        />
      )}
    </>
  );
}

function ShapeNode({
  el,
  label,
  boxW,
  boxH,
}: {
  el: LabelElement;
  label: LabelTemplate;
  boxW: number;
  boxH: number;
}) {
  if (el.type === "divider") {
    return (
      <Line
        points={[0, boxH / 2, boxW, boxH / 2]}
        stroke={el.colorOverride || label.textColor}
        strokeWidth={1}
      />
    );
  }
  const stroke = el.strokeColor || label.textColor;
  const strokeWidth = (el.strokeWidth || 2) * 0.75;
  const fill = el.fillColor || undefined;
  if (el.type === "rect") {
    return <Rect width={boxW} height={boxH} stroke={stroke} strokeWidth={strokeWidth} fill={fill} />;
  }
  if (el.type === "circle") {
    return (
      <Ellipse
        x={boxW / 2}
        y={boxH / 2}
        radiusX={boxW / 2}
        radiusY={boxH / 2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        fill={fill}
      />
    );
  }
  return <Line points={[0, boxH / 2, boxW, boxH / 2]} stroke={stroke} strokeWidth={strokeWidth} />;
}

const NFP_FONT_STACK = "'Arial', 'Helvetica', sans-serif";

const NFP_PLACEHOLDER: Partial<Record<keyof NfpData, string>> = {
  servingSize: "1 serving",
  servings: "1",
};

function NfpNode({
  el,
  boxW,
  boxH,
  editing,
}: {
  el: LabelElement;
  boxW: number;
  boxH: number;
  editing: boolean;
}) {
  const d = el.nfpData;
  if (!d) return null;

  const rows = NFP_ROWS.filter(
    (r) => r.group !== "micro" || editing || (d[r.key] || "").trim() !== ""
  );

  const border = 2;
  const padX = boxW * 0.035;
  const padY = boxH * 0.02;
  const innerW = boxW - padX * 2;
  const slot = boxH / (rows.length + 3);
  const titleFs = slot * 1.0;
  const rowFs = slot * 0.48;
  const headFs = slot * 0.42;
  const footFs = slot * 0.34;
  const dvColW = innerW * 0.16;
  const valGap = innerW * 0.01;
  const indentW = boxW * 0.03;
  const titleSep = Math.max(2, slot * 0.14);

  const nodes: ReactNode[] = [];
  let y = padY;

  nodes.push(
    <Text
      key="nfp-title"
      x={padX}
      y={y}
      width={innerW}
      text="Nutrition Facts"
      fontFamily={NFP_FONT_STACK}
      fontSize={titleFs}
      fontStyle="bold"
      fill="#000000"
      lineHeight={1}
      letterSpacing={-titleFs * 0.02}
    />
  );
  y += slot * 1.05;
  nodes.push(
    <Line key="nfp-sep-title" points={[padX, y, padX + innerW, y]} stroke="#000000" strokeWidth={titleSep} />
  );
  y += titleSep;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const raw = (d[r.key] || "").trim();
    const val = raw || NFP_PLACEHOLDER[r.key] || "0";
    const dv = dvPercent(raw, r.dvThreshold);
    const ty = y + (slot - rowFs) / 2;
    const lx = padX + r.indent * indentW;
    nodes.push(
      <Text
        key={`nfp-l-${r.key}`}
        x={lx}
        y={ty}
        text={r.label}
        fontFamily={NFP_FONT_STACK}
        fontSize={rowFs}
        fontStyle={r.bold ? "bold" : "normal"}
        fill="#000000"
        lineHeight={1}
      />
    );
    nodes.push(
      <Text
        key={`nfp-v-${r.key}`}
        x={padX}
        y={ty}
        width={innerW - dvColW - valGap}
        align="right"
        text={val}
        fontFamily={NFP_FONT_STACK}
        fontSize={rowFs}
        fontStyle={r.bold ? "bold" : "normal"}
        fill="#000000"
        lineHeight={1}
      />
    );
    if (dv) {
      nodes.push(
        <Text
          key={`nfp-dv-${r.key}`}
          x={padX}
          y={ty}
          width={innerW}
          align="right"
          text={dv}
          fontFamily={NFP_FONT_STACK}
          fontSize={rowFs}
          fontStyle="bold"
          fill="#000000"
          lineHeight={1}
        />
      );
    }

    const next = rows[i + 1];
    const sepW = r.key === "calories" ? 3 : next && next.group === "micro" ? 2 : 1;
    y += slot;
    nodes.push(
      <Line key={`nfp-sep-${r.key}`} points={[padX, y, padX + innerW, y]} stroke="#000000" strokeWidth={sepW} />
    );

    if (r.key === "calories") {
      y += sepW;
      nodes.push(
        <Text
          key="nfp-dvhead"
          x={padX}
          y={y}
          width={innerW}
          align="right"
          text="% Daily Value*"
          fontFamily={NFP_FONT_STACK}
          fontSize={headFs}
          fontStyle="bold"
          fill="#000000"
          lineHeight={1}
        />
      );
      y += slot * 0.7;
    }
  }

  const footH = footFs * 1.15 * 2;
  const fy = Math.max(y + 2, boxH - padY - border - footH);
  nodes.push(
    <Line key="nfp-sep-foot" points={[padX, fy - 2, padX + innerW, fy - 2]} stroke="#000000" strokeWidth={1} />
  );
  nodes.push(
    <Text
      key="nfp-foot"
      x={padX}
      y={fy}
      width={innerW}
      text="* The % Daily Value tells you how much a nutrient in a serving of food contributes to a daily diet."
      fontFamily={NFP_FONT_STACK}
      fontSize={footFs}
      fill="#000000"
      lineHeight={1.15}
      wrap="word"
    />
  );

  return (
    <>
      <Rect width={boxW} height={boxH} fill="#ffffff" />
      {nodes}
      <Rect
        x={border / 2}
        y={border / 2}
        width={boxW - border}
        height={boxH - border}
        stroke="#000000"
        strokeWidth={border}
      />
    </>
  );
}

export function ElementNode({
  el,
  label,
  profile,
  W,
  H,
  selected,
  editing,
  bestByStr,
  registerRef,
  onSelectEl,
  onEditStartEl,
  onDragStartEl,
  onDragMoveEl,
  onDragEndEl,
  onTransformEndEl,
}: Props) {
  if (el.hidden) return null;

  const boxW = el.w * W;
  const boxH = el.h * H;
  const text = el.type === "text" ? effectiveText(el, label, profile, bestByStr) : "";
  if (el.type === "text" && !text && !selected && !editing) return null;

  return (
    <Group
      ref={(n: Konva.Group | null) => registerRef(el.id, n)}
      x={el.x * W + boxW / 2}
      y={el.y * H + boxH / 2}
      offsetX={boxW / 2}
      offsetY={boxH / 2}
      rotation={el.rotation || 0}
      opacity={el.opacity ?? 1}
      draggable={!el.lock}
      onClick={() => onSelectEl?.(el.id)}
      onTap={() => onSelectEl?.(el.id)}
      onDblClick={() => {
        if (el.type === "text") onEditStartEl?.(el.id);
      }}
      onDblTap={() => {
        if (el.type === "text") onEditStartEl?.(el.id);
      }}
      onDragStart={(e) => onDragStartEl?.(el.id, e.target)}
      onDragMove={(e) => onDragMoveEl?.(el.id, e.target)}
      onDragEnd={(e) => onDragEndEl?.(el.id, e.target)}
      onTransformEnd={(e) => onTransformEndEl?.(el.id, e.target)}
      clipFunc={(ctx: SceneContext) => {
        ctx.beginPath();
        ctx.rect(0, 0, boxW, boxH);
      }}
    >
      {el.type === "text" && <TextNode el={el} label={label} W={W} text={text} />}
      {el.type === "logo" && <LogoNode label={label} W={W} boxW={boxW} boxH={boxH} />}
      {el.type === "qr" && (
        <QrNode el={el} label={label} profile={profile} boxW={boxW} boxH={boxH} />
      )}
      {(el.type === "rect" ||
        el.type === "circle" ||
        el.type === "line" ||
        el.type === "divider") && <ShapeNode el={el} label={label} boxW={boxW} boxH={boxH} />}
      {el.type === "nfp" && <NfpNode el={el} boxW={boxW} boxH={boxH} editing={editing} />}
    </Group>
  );
}

export default memo(ElementNode);
