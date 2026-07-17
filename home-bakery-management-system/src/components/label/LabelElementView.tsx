import { QRCodeSVG } from "qrcode.react";
import type { BusinessProfile, LabelElement, LabelTemplate } from "../../types";
import { disclaimerText } from "../../utils/disclaimer";
import NutritionFactsPanel from "./NutritionFactsPanel";

interface Props {
  el: LabelElement;
  label: LabelTemplate;
  profile: BusinessProfile;
  selected: boolean;
  bestByDate: Date;
  onSelect: (id: string) => void;
  onPointerDown: (e: React.PointerEvent, el: LabelElement, handle: string) => void;
  onDoubleClick: (el: LabelElement) => void;
  editingId: string | null;
  onTextCommit: (field: string, value: string) => void;
  onStopEdit: () => void;
}

export default function LabelElementView({
  el,
  label,
  profile,
  selected,
  bestByDate,
  onSelect,
  onPointerDown,
  onDoubleClick,
  editingId,
  onTextCommit,
  onStopEdit,
}: Props) {
  if (el.hidden) return null;

  const effectiveBusinessName = label.businessName || profile.name;
  const effectivePhone = label.phoneNumber || profile.phone;
  const effectiveReg = label.registrationNumber || profile.registrationNumber;
  const effectiveAddress = label.address || profile.address;
  const website = label.websiteUrl || profile.website || "https://muy-rico.com";
  const isRegistered = label.businessIdMode === "registration";
  const disclaimer = disclaimerText(label.disclaimerVariant, label.productType);

  let text = "";
  switch (el.field) {
    case "businessName":
      text = effectiveBusinessName;
      break;
    case "businessId":
      text = isRegistered
        ? `${effectivePhone}\u00A0\u00B7\u00A0${effectiveReg || "(reg#)"}`
        : effectiveAddress;
      break;
    case "productName":
      text = label.productName || "Product Name";
      break;
    case "details":
      text = label.details;
      break;
    case "ingredients":
      text = label.ingredients ? `Ingredients: ${label.ingredients}` : "";
      break;
    case "allergens":
      text = label.allergens;
      break;
    case "netWeight":
      text = label.netWeight;
      break;
    case "price":
      text = label.showPrice ? label.price : "";
      break;
    case "bestBy":
      text = label.showBestBy
        ? `Best by ${bestByDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : "";
      break;
    case "disclaimer":
      text = label.showDisclaimer ? disclaimer : "";
      break;
    default:
      text = "";
  }

  // Skip empty text (except when selected so user can still place it)
  if (el.type === "text" && !text && !selected && editingId !== el.id) return null;

  const align = el.alignOverride || "center";
  const fontSize = el.fontSizeOverride ?? 4;
  const color = el.colorOverride || label.textColor;
  const fontFamily = el.fontFamilyOverride || label.font;
  const opacity = el.opacity ?? 1;
  const rotation = el.rotation || 0;

  const style: React.CSSProperties = {
    position: "absolute",
    left: `${el.x * 100}%`,
    top: `${el.y * 100}%`,
    width: `${el.w * 100}%`,
    height: `${el.h * 100}%`,
    zIndex: el.z,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
    opacity,
    color,
    fontFamily,
    fontSize: `${fontSize}cqw`,
    fontWeight: el.bold ? 700 : 400,
    fontStyle: el.italic ? "italic" : "normal",
    textDecoration: el.underline ? "underline" : "none",
    textAlign: align,
    display: "flex",
    alignItems: el.type === "text" ? "flex-start" : "center",
    justifyContent:
      align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
    overflow: "hidden",
    lineHeight: 1.2,
    cursor: el.lock ? "default" : "move",
    userSelect: "none",
    boxSizing: "border-box",
  };

  const isEditing = editingId === el.id && el.type === "text";

  return (
    <div
      data-el-id={el.id}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(el.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (el.type === "text") onDoubleClick(el);
      }}
      onPointerDown={(e) => {
        if (isEditing) return;
        onPointerDown(e, el, "move");
      }}
    >
      {el.type === "logo" && (
        label.logoImage ? (
          <img
            src={label.logoImage}
            alt="Logo"
            crossOrigin="anonymous"
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <span className="leading-none" style={{ fontSize: `${(label.logoSize ?? 16)}cqw` }}>
            {label.logoEmoji || ""}
          </span>
        )
      )}

      {el.type === "qr" && (
        <div className="flex h-full w-full items-center justify-center bg-white p-[4%]">
          <QRCodeSVG
            value={website}
            size={256}
            level={el.qrErrorLevel || "M"}
            bgColor="#ffffff"
            fgColor={el.colorOverride || "#000000"}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      )}

      {el.type === "divider" && (
        <div
          className="w-full"
          style={{ height: 1, backgroundColor: color, opacity: opacity }}
        />
      )}

      {el.type === "rect" && (
        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <rect
            x={0}
            y={0}
            width={100}
            height={100}
            stroke={el.strokeColor || "#333"}
            strokeWidth={el.strokeWidth || 2}
            fill={el.fillColor || "transparent"}
          />
        </svg>
      )}

      {el.type === "circle" && (
        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <ellipse
            cx={50}
            cy={50}
            rx={50}
            ry={50}
            stroke={el.strokeColor || "#333"}
            strokeWidth={el.strokeWidth || 2}
            fill={el.fillColor || "transparent"}
          />
        </svg>
      )}

      {el.type === "line" && (
        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            x1={0}
            y1={50}
            x2={100}
            y2={50}
            stroke={el.strokeColor || "#333"}
            strokeWidth={el.strokeWidth || 2}
          />
        </svg>
      )}

      {el.type === "nfp" && el.nfpData && (
        <NutritionFactsPanel nfpData={el.nfpData} editable={false} />
      )}

      {el.type === "text" && (
        isEditing ? (
          <div
            contentEditable
            suppressContentEditableWarning
            className="h-full w-full outline-none"
            style={{ textAlign: align }}
            autoFocus
            onBlur={(e) => {
              const val = e.currentTarget.innerText;
              // Map field back to template key
              if (el.field === "ingredients" && val.startsWith("Ingredients: ")) {
                onTextCommit("ingredients", val.slice("Ingredients: ".length));
              } else if (el.field === "businessId") {
                // Don't commit businessId as free text into a single field
              } else if (el.field === "disclaimer") {
                // disclaimer is fixed legal text
              } else if (el.field === "bestBy") {
                // computed
              } else if (el.field === "price" || el.field === "netWeight" || el.field === "productName" || el.field === "details" || el.field === "allergens" || el.field === "businessName") {
                onTextCommit(el.field, val);
              }
              onStopEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onStopEdit();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.target as HTMLElement).blur();
              }
            }}
            dangerouslySetInnerHTML={{ __html: text.replace(/\n/g, "<br/>") }}
          />
        ) : (
          <span className="w-full break-words" style={{ textAlign: align }}>
            {text}
          </span>
        )
      )}

      {selected && !el.lock && (
        <SelectionHandles el={el} onPointerDown={onPointerDown} />
      )}
      {selected && (
        <div
          className="deco-layer pointer-events-none absolute inset-0 ring-2 ring-coral ring-offset-0"
          style={{ borderRadius: 2 }}
        />
      )}
    </div>
  );
}

const HANDLES: { key: string; style: React.CSSProperties }[] = [
  { key: "nw", style: { left: -4, top: -4, cursor: "nwse-resize" } },
  { key: "n", style: { left: "50%", top: -4, marginLeft: -4, cursor: "ns-resize" } },
  { key: "ne", style: { right: -4, top: -4, cursor: "nesw-resize" } },
  { key: "e", style: { right: -4, top: "50%", marginTop: -4, cursor: "ew-resize" } },
  { key: "se", style: { right: -4, bottom: -4, cursor: "nwse-resize" } },
  { key: "s", style: { left: "50%", bottom: -4, marginLeft: -4, cursor: "ns-resize" } },
  { key: "sw", style: { left: -4, bottom: -4, cursor: "nesw-resize" } },
  { key: "w", style: { left: -4, top: "50%", marginTop: -4, cursor: "ew-resize" } },
];

function SelectionHandles({
  el,
  onPointerDown,
}: {
  el: LabelElement;
  onPointerDown: (e: React.PointerEvent, el: LabelElement, handle: string) => void;
}) {
  return (
    <div className="deco-layer absolute inset-0">
      {HANDLES.map((h) => (
        <div
          key={h.key}
          className="absolute h-2 w-2 rounded-sm border border-coral bg-white shadow"
          style={h.style}
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown(e, el, h.key);
          }}
        />
      ))}
      {/* rotate knob */}
      <div
        className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full border border-coral bg-white shadow"
        style={{ top: -22, cursor: "grab" }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onPointerDown(e, el, "rotate");
        }}
      />
      <div
        className="absolute left-1/2 w-px bg-coral"
        style={{ top: -18, height: 14, marginLeft: -0.5 }}
      />
    </div>
  );
}
