import { useEffect, useState } from "react";
import {
  Circle as CircleIcon,
  Image as ImageIcon,
  Minus,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Upload,
  X,
} from "lucide-react";
import type { ChangeEvent } from "react";
import type { LabelElement, LabelShape } from "../../../types";
import { defaultNfpElement, defaultShapeElement } from "../../../components/label/defaultElements";
import { newId } from "../../../utils/format";
import { rescaleTemplateForDimensions } from "../templateUtils";
import { selectElements, useEditorStore } from "../state";

const FONT_CHOICES = [
  { label: "Elegant Serif", value: "'Cormorant Garamond', Georgia, serif" },
  { label: "Friendly Rounded", value: "'Quicksand', 'Comic Sans MS', sans-serif" },
  { label: "Classic Sans", value: "'Poppins', 'Segoe UI', sans-serif" },
  { label: "Handwritten", value: "'Caveat', cursive" },
  { label: "Playfair Display", value: "'Playfair Display', Georgia, serif" },
  { label: "Lato", value: "'Lato', sans-serif" },
  { label: "Montserrat", value: "'Montserrat', sans-serif" },
  { label: "Oswald", value: "'Oswald', sans-serif" },
];

const COLOR_PRESETS = [
  { bg: "#FBF3E7", accent: "#C17A3F", text: "#4A3222" },
  { bg: "#FDECEF", accent: "#d93d59", text: "#5B2A34" },
  { bg: "#EAF3EA", accent: "#40916c", text: "#2E4530" },
  { bg: "#EAF1FB", accent: "#5B84B1", text: "#2B3F55" },
  { bg: "#111111", accent: "#f7a8a4", text: "#FFFFFF" },
];

const SHAPES: { value: LabelShape; label: string }[] = [
  { value: "rounded", label: "Rounded" },
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "oval", label: "Oval" },
];

const LABEL_SIZES = [
  { label: 'Avery 5164 (3.33×4")', w: 3.33, h: 4 },
  { label: 'Avery 5163 (2×4")', w: 2, h: 4 },
  { label: 'Avery 8163 (2×4")', w: 2, h: 4 },
  { label: '2"×2"', w: 2, h: 2 },
  { label: '2.5"×3.5"', w: 2.5, h: 3.5 },
  { label: '2.5"×4"', w: 2.5, h: 4 },
  { label: '3"×3"', w: 3, h: 3 },
  { label: '3"×4"', w: 3, h: 4 },
  { label: '3"×5"', w: 3, h: 5 },
];

const EMOJI_CHOICES = ["🧁", "🎂", "🍪", "🥖", "🍞", "🍩", "🥧", "🍫", "✨", "🌿"];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-cocoa-muted">
        {title}
      </p>
      {children}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="h-8 w-8 cursor-pointer rounded border-none bg-transparent p-0"
      />
      <span className="text-[10px] text-cocoa-muted">{label}</span>
    </div>
  );
}

export default function AddTab() {
  const doc = useEditorStore((s) => s.doc);
  const updateField = useEditorStore((s) => s.updateField);
  const setDoc = useEditorStore((s) => s.setDoc);
  const elements = useEditorStore(selectElements);

  const [uploadError, setUploadError] = useState<string | null>(null);
  const [customW, setCustomW] = useState(String(doc.labelWidth || 3));
  const [customH, setCustomH] = useState(String(doc.labelHeight || 4));

  useEffect(() => {
    setCustomW(String(doc.labelWidth));
    setCustomH(String(doc.labelHeight));
  }, [doc.labelWidth, doc.labelHeight]);

  const isSquareShape = doc.shape === "circle" || doc.shape === "square";
  const logoSize = doc.logoSize ?? 16;
  const hasLogo = Boolean(doc.logoImage) || Boolean(doc.logoEmoji);
  const qrEl = elements.find((e) => e.field === "qr");

  function insertElement(base: Partial<LabelElement>) {
    const els = selectElements(useEditorStore.getState());
    const maxZ = els.reduce((m, e) => Math.max(m, e.z), 0);
    const el: LabelElement = { ...(base as LabelElement), id: newId("el"), z: maxZ + 1 };
    useEditorStore.getState().setElements([...els, el]);
    useEditorStore.getState().select(el.id);
  }

  function changeShape(next: LabelShape) {
    setDoc(
      rescaleTemplateForDimensions(doc, {
        labelWidth: doc.labelWidth,
        labelHeight: doc.labelHeight,
        shape: next,
        orientation: doc.orientation || "portrait",
      }),
      true
    );
  }

  function applySize(w: number, h: number) {
    setDoc(
      rescaleTemplateForDimensions(doc, {
        labelWidth: w,
        labelHeight: h,
        shape: doc.shape,
        orientation: doc.orientation || "portrait",
      }),
      true
    );
    setCustomW(String(w));
    setCustomH(String(h));
  }

  function applyPreset(preset: (typeof COLOR_PRESETS)[number]) {
    setDoc(
      { ...doc, bgColor: preset.bg, accentColor: preset.accent, textColor: preset.text },
      true
    );
  }

  function handleImageUpload(e: ChangeEvent<HTMLInputElement>, field: "logoImage" | "bgImage") {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError("Image must be under 5MB");
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError("Only PNG, JPG, and SVG images are accepted");
      return;
    }
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        updateField(field, event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  }

  const insertButtons: { label: string; icon?: typeof Square; base: Partial<LabelElement> }[] = [
    {
      label: "Text",
      base: {
        type: "text",
        text: "Double-tap to edit",
        x: 0.3,
        y: 0.42,
        w: 0.4,
        h: 0.08,
        rotation: 0,
      },
    },
    {
      label: "Divider",
      base: {
        ...defaultShapeElement("line"),
        type: "divider",
        field: "divider",
        x: 0.2,
        y: 0.495,
        w: 0.6,
        h: 0.01,
      },
    },
    { label: "Rectangle", base: defaultShapeElement("rect") },
    { label: "Circle", base: defaultShapeElement("circle") },
    { label: "Line", base: defaultShapeElement("line") },
    { label: "Nutrition Facts", base: defaultNfpElement() },
  ];

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      {uploadError && (
        <p className="rounded-lg border border-hibiscus/30 bg-hibiscus-light/10 px-3 py-2 text-xs font-medium text-hibiscus">
          {uploadError}
        </p>
      )}

      <Section title="Insert element">
        <div className="grid grid-cols-2 gap-2">
          {insertButtons.map(({ label, base }) => (
            <button
              key={label}
              type="button"
              onClick={() => insertElement(base)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-dashed border-sand-300 px-2 py-2 text-xs font-medium text-cocoa-muted transition hover:border-palm hover:bg-palm-50 hover:text-palm"
            >
              {base.type === "nfp" ? (
                <ImageIcon size={13} />
              ) : base.type === "divider" || base.type === "line" ? (
                <Minus size={13} />
              ) : base.type === "rect" ? (
                <Square size={13} />
              ) : base.type === "circle" ? (
                <CircleIcon size={13} />
              ) : null}
              {label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Shape">
        <div className="grid grid-cols-2 gap-2">
          {SHAPES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => changeShape(s.value)}
              className={`min-h-11 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                doc.shape === s.value
                  ? "border-palm bg-palm text-white"
                  : "border-sand-200 text-cocoa-muted hover:bg-sand-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Label size">
        <div className="grid grid-cols-2 gap-2">
          {LABEL_SIZES.map((s) => (
            <button
              key={`${s.w}x${s.h}`}
              type="button"
              onClick={() => applySize(s.w, s.h)}
              className={`min-h-11 rounded-lg border px-2 py-2 text-[11px] font-medium leading-tight transition ${
                doc.labelWidth === s.w && doc.labelHeight === s.h
                  ? "border-palm bg-palm text-white"
                  : "border-sand-200 text-cocoa-muted hover:bg-sand-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-cocoa-muted">Custom:</span>
          <input
            type="number"
            min={1.57}
            max={4.3}
            step={0.1}
            value={customW}
            onChange={(e) => setCustomW(e.target.value)}
            onBlur={() => {
              const n = Number(customW) || 3;
              setCustomW(String(n));
              setDoc(
                rescaleTemplateForDimensions(doc, {
                  labelWidth: n,
                  labelHeight: Number(customH) || doc.labelHeight,
                  shape: doc.shape,
                  orientation: doc.orientation || "portrait",
                }),
                true
              );
            }}
            aria-label="Custom width (in)"
            className="input min-h-11 w-16 text-xs"
          />
          <span className="text-xs text-cocoa-muted">×</span>
          <input
            type="number"
            min={1}
            max={8}
            step={0.1}
            value={customH}
            onChange={(e) => setCustomH(e.target.value)}
            onBlur={() => {
              const n = Number(customH) || 4;
              setCustomH(String(n));
              setDoc(
                rescaleTemplateForDimensions(doc, {
                  labelWidth: Number(customW) || doc.labelWidth,
                  labelHeight: n,
                  shape: doc.shape,
                  orientation: doc.orientation || "portrait",
                }),
                true
              );
            }}
            aria-label="Custom height (in)"
            className="input min-h-11 w-16 text-xs"
          />
          <span className="text-[10px] text-cocoa-muted">in</span>
        </div>

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={isSquareShape}
            onClick={() =>
              setDoc(
                rescaleTemplateForDimensions(doc, {
                  labelWidth: doc.labelWidth,
                  labelHeight: doc.labelHeight,
                  shape: doc.shape,
                  orientation: "portrait",
                }),
                true
              )
            }
            className={`flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${
              doc.orientation === "portrait" && !isSquareShape
                ? "border-palm bg-palm text-white"
                : "border-sand-200 text-cocoa-muted"
            } disabled:opacity-40`}
          >
            <RectangleVertical size={14} /> Portrait
          </button>
          <button
            type="button"
            disabled={isSquareShape}
            onClick={() =>
              setDoc(
                rescaleTemplateForDimensions(doc, {
                  labelWidth: doc.labelWidth,
                  labelHeight: doc.labelHeight,
                  shape: doc.shape,
                  orientation: "landscape",
                }),
                true
              )
            }
            className={`flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium transition ${
              doc.orientation === "landscape" && !isSquareShape
                ? "border-palm bg-palm text-white"
                : "border-sand-200 text-cocoa-muted"
            } disabled:opacity-40`}
          >
            <RectangleHorizontal size={14} /> Landscape
          </button>
        </div>
      </Section>

      <Section title="Color palette">
        <div className="flex flex-wrap gap-2">
          {COLOR_PRESETS.map((preset, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => applyPreset(preset)}
              title={`Preset ${idx + 1}`}
              aria-label={`Apply palette preset ${idx + 1}`}
              className="h-11 w-11 rounded-full border-2 border-white shadow ring-1 ring-sand-200 transition hover:scale-105"
              style={{
                background: `linear-gradient(135deg, ${preset.bg} 50%, ${preset.accent} 50%)`,
              }}
            />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <ColorField label="Background" value={doc.bgColor} onChange={(v) => updateField("bgColor", v)} />
          <ColorField label="Accent" value={doc.accentColor} onChange={(v) => updateField("accentColor", v)} />
          <ColorField label="Text" value={doc.textColor} onChange={(v) => updateField("textColor", v)} />
        </div>
      </Section>

      <Section title="Font">
        <select
          value={doc.font}
          onChange={(e) => updateField("font", e.target.value)}
          className="input min-h-11"
        >
          {FONT_CHOICES.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Section>

      <Section title="Icon or Logo">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <label className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-sand-300 py-2 text-xs font-medium text-cocoa transition hover:bg-sand-50">
              <Upload size={14} /> Upload Custom Logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                className="hidden"
                onChange={(e) => handleImageUpload(e, "logoImage")}
              />
            </label>
            <button
              type="button"
              onClick={() => setDoc({ ...doc, logoImage: undefined, logoEmoji: "" }, true)}
              className={`flex min-h-11 items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium transition ${
                !hasLogo
                  ? "border-coral bg-coral-light/20 text-coral"
                  : "border-sand-300 text-cocoa-muted hover:bg-sand-50"
              }`}
            >
              None
            </button>
            {doc.logoImage && (
              <button
                type="button"
                onClick={() => updateField("logoImage", undefined)}
                aria-label="Remove logo image"
                className="flex min-h-11 items-center justify-center rounded-lg border border-hibiscus/30 px-3 py-2 text-hibiscus transition hover:bg-hibiscus-light/10"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {EMOJI_CHOICES.map((em) => (
              <button
                key={em}
                type="button"
                onClick={() => setDoc({ ...doc, logoEmoji: em, logoImage: undefined }, true)}
                className={`flex h-11 w-11 items-center justify-center rounded-lg border text-lg transition ${
                  !doc.logoImage && doc.logoEmoji === em
                    ? "border-coral bg-coral-light/20"
                    : "border-sand-200 hover:bg-sand-50"
                }`}
              >
                {em}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-[10px] text-cocoa-muted">Logo size</span>
            <input
              type="range"
              min={8}
              max={40}
              step={1}
              value={logoSize}
              disabled={!hasLogo}
              onChange={(e) => updateField("logoSize", Number(e.target.value))}
              aria-label="Logo size"
              className="flex-1 accent-coral"
            />
            <span className="w-8 text-right text-[10px] tabular-nums text-cocoa-muted">{logoSize}</span>
          </div>
        </div>
      </Section>

      <Section title="Background image">
        <label className="flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-sand-300 py-2 text-xs font-medium text-cocoa transition hover:bg-sand-50">
          <ImageIcon size={14} /> Upload background
          <input
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            className="hidden"
            onChange={(e) => handleImageUpload(e, "bgImage")}
          />
        </label>
        {doc.bgImage && (
          <button
            type="button"
            onClick={() => updateField("bgImage", undefined)}
            className="mt-1 min-h-11 w-full rounded border border-hibiscus/30 px-2 py-1 text-[11px] text-hibiscus transition hover:bg-hibiscus-light/10"
          >
            Clear background image
          </button>
        )}
      </Section>

      <Section title="Website & QR">
        <input
          value={doc.websiteUrl}
          onChange={(e) => updateField("websiteUrl", e.target.value)}
          placeholder="https://muy-rico.com"
          aria-label="Website URL"
          className="input min-h-11"
        />
        <label className="mt-2 flex min-h-11 items-center gap-2 text-xs text-cocoa">
          <input
            type="checkbox"
            checked={qrEl ? !qrEl.hidden : false}
            onChange={(e) => {
              if (!qrEl) return;
              useEditorStore
                .getState()
                .patchElement(qrEl.id, { hidden: !e.target.checked });
            }}
          />
          Show QR code on this label
        </label>
      </Section>
    </div>
  );
}
