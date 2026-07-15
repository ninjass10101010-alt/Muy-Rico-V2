import { useRef, useState, useCallback } from "react";
import { toPng } from "html-to-image";
import { Download, Printer, Save, Tag, Trash2, AlertTriangle, Upload, X } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { newId } from "../utils/format";
import Modal from "../components/ui/Modal";
import type { LabelShape, LabelTemplate } from "../types";

const FONT_CHOICES = [
  { label: "Elegant Serif", value: "'Cormorant Garamond', Georgia, serif" },
  { label: "Friendly Rounded", value: "'Quicksand', 'Comic Sans MS', sans-serif" },
  { label: "Classic Sans", value: "'Poppins', 'Segoe UI', sans-serif" },
  { label: "Handwritten", value: "'Caveat', cursive" },
];

const COLOR_PRESETS = [
  { bg: "#FBF3E7", accent: "#C17A3F", text: "#4A3222" },
  { bg: "#FDECEF", accent: "#d93d59", text: "#5B2A34" },
  { bg: "#EAF3EA", accent: "#40916c", text: "#2E4530" },
  { bg: "#EAF1FB", accent: "#5B84B1", text: "#2B3F55" },
  { bg: "#111111", accent: "#f7a8a4", text: "#FFFFFF" },
];

const SHAPES: { value: LabelShape; label: string }[] = [
  { value: "rounded", label: "Rounded Rectangle" },
  { value: "square", label: "Square" },
  { value: "circle", label: "Circle" },
  { value: "oval", label: "Oval" },
];

const LABEL_SIZES = [
  { label: "3\"\u00d74\"", w: 3, h: 4 },
  { label: "3\"\u00d75\"", w: 3, h: 5 },
  { label: "4\"\u00d73\"", w: 4, h: 3 },
  { label: "2.5\"\u00d74\"", w: 2.5, h: 4 },
];

const EMOJI_CHOICES = ["\u{1F9C1}", "\u{1F382}", "\u{1F36A}", "\u{1F950}", "\u{1F35E}", "\u{1F369}", "\u{1F967}", "\u{1F36B}", "\u2728", "\u{1F33F}"];

export default function LabelDesigner({ filterByOrder }: { filterByOrder?: string | null }) {
  const { labelTemplates, handleCreateLabel, handleUpdateLabel, handleDeleteLabel, products, profile } = useStore();

  // When coming from an order, pre-filter and load the first matching label
  const orderTemplates = filterByOrder
    ? labelTemplates.filter(t => t.name.includes(filterByOrder))
    : null;

  const [label, setLabel] = useState<LabelTemplate>(
    (orderTemplates && orderTemplates.length > 0 ? orderTemplates[0] : labelTemplates[0])
  );
  const previewRef = useRef<HTMLDivElement>(null);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function update<K extends keyof LabelTemplate>(key: K, value: LabelTemplate[K]) {
    setLabel((l) => ({ ...l, [key]: value }));
  }

  function applyPreset(preset: (typeof COLOR_PRESETS)[number]) {
    setLabel((l) => ({ ...l, bgColor: preset.bg, accentColor: preset.accent, textColor: preset.text }));
  }

  function loadFromProduct(productId: string) {
    const p = products.find((pr) => pr.id === productId);
    if (!p) return;
    setLabel((l) => ({
      ...l,
      productName: p.name,
      details: p.description,
      ingredients: p.ingredients,
      allergens: p.allergens,
      price: `$${p.price.toFixed(2)}`,
      logoEmoji: p.emoji,
    }));
  }

  async function saveTemplate() {
    const exists = labelTemplates.find((t) => t.id === label.id);
    if (exists) {
      await handleUpdateLabel(label.id, label);
    } else {
      const saved = { ...label, id: newId("label") };
      await handleCreateLabel(saved);
      setLabel(saved);
    }
  }

  async function newTemplate() {
    const fresh: LabelTemplate = {
      ...label,
      id: newId("label"),
      name: "Untitled Label",
    };
    await handleCreateLabel(fresh);
    setLabel(fresh);
  }

  function removeTemplate(id: string) {
    handleDeleteLabel(id);
    if (label.id === id && labelTemplates.length > 1) {
      setLabel(labelTemplates.find((t) => t.id !== id)!);
    }
  }

  function handleToggleDisclaimer() {
    if (label.showDisclaimer) {
      setShowDisclaimerModal(true);
    } else {
      update("showDisclaimer", true);
    }
  }

  function confirmHideDisclaimer() {
    update("showDisclaimer", false);
    setShowDisclaimerModal(false);
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        update("logoImage", event.target.result as string);
      }
    };
    reader.readAsDataURL(file);
  }

  // Effective printed dimensions: circle/square become 1:1 (true circle/square);
  // oval/rounded keep the label's physical aspect ratio.
  const isSquareShape = label.shape === "circle" || label.shape === "square";
  const effW = isSquareShape ? Math.min(label.labelWidth, label.labelHeight) : label.labelWidth;
  const effH = isSquareShape ? Math.min(label.labelWidth, label.labelHeight) : label.labelHeight;
  const isCurved = label.shape === "circle" || label.shape === "oval";
  const padClass = isCurved ? "p-[14%]" : "p-[7%]";
  const disclaimerCqw = 1100 / (72 * effW);

  const downloadPng = useCallback(async () => {
    if (!previewRef.current) return;
    setDownloadError(null);
    const el = previewRef.current;
    const rect = el.getBoundingClientRect();
    const targetWidth = effW * 203;
    const dpr = rect.width ? targetWidth / rect.width : 1;
    try {
      const dataUrl = await toPng(el, { pixelRatio: dpr, cacheBust: true });
      const link = document.createElement("a");
      link.download = `${label.productName || "label"}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Label PNG export failed:", err);
      setDownloadError(
        "Could not export the label image. If it uses an uploaded logo, the image host may block downloads — try removing the logo or re-uploading it."
      );
    }
  }, [effW, label.productName]);

  function printLabel() {
    window.print();
  }

  const bestByDate = new Date();
  bestByDate.setDate(bestByDate.getDate() + label.bestByDays);

  const effectiveBusinessName = label.businessName || profile.name;
  const effectivePhone = label.phoneNumber || profile.phone;
  const effectiveReg = label.registrationNumber || profile.registrationNumber;
  const effectiveAddress = label.address || profile.address;
  const effectiveFont = label.font;
  const effectiveBg = label.bgColor;
  const effectiveAccent = label.accentColor;
  const effectiveText = label.textColor;
  const isRegistered = label.businessIdMode === "registration";

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr_300px]">
      {/* Controls */}
      <div className="space-y-4">
        <Section title="Load from product">
          <select
            onChange={(e) => e.target.value && loadFromProduct(e.target.value)}
            className="input"
            defaultValue=""
          >
            <option value="">Select a product...</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.emoji} {p.name}
              </option>
            ))}
          </select>
        </Section>

        <Section title="Shape & decoration">
          <div className="grid grid-cols-2 gap-2">
            {SHAPES.map((s) => (
              <button
                key={s.value}
                onClick={() => update("shape", s.value)}
                className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                  label.shape === s.value ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted"
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
                onClick={() => { update("labelWidth", s.w); update("labelHeight", s.h); }}
                className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                  label.labelWidth === s.w && label.labelHeight === s.h
                    ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-cocoa-muted">
            Matches your MUNBYN ITPP130B (1.57\u20134.3" wide)
          </p>
        </Section>

        <Section title="Color palette">
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => applyPreset(preset)}
                className="h-9 w-9 rounded-full border-2 border-white shadow ring-1 ring-sand-200"
                style={{ background: `linear-gradient(135deg, ${preset.bg} 50%, ${preset.accent} 50%)` }}
              />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <ColorField label="Background" value={label.bgColor} onChange={(v) => update("bgColor", v)} />
            <ColorField label="Accent" value={label.accentColor} onChange={(v) => update("accentColor", v)} />
            <ColorField label="Text" value={label.textColor} onChange={(v) => update("textColor", v)} />
          </div>
        </Section>

        <Section title="Font">
          <select
            value={label.font}
            onChange={(e) => update("font", e.target.value)}
            className="input"
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
              <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-sand-300 py-2 text-xs font-medium text-cocoa hover:bg-sand-50">
                <Upload size={14} /> Upload Custom Logo
                <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
              {label.logoImage && (
                <button
                  onClick={() => update("logoImage", undefined)}
                  className="flex items-center justify-center rounded-lg border border-hibiscus/30 px-3 py-2 text-hibiscus hover:bg-hibiscus-light/10"
                  title="Remove Logo"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {EMOJI_CHOICES.map((em) => (
                <button
                  key={em}
                  onClick={() => {
                    update("logoEmoji", em);
                    update("logoImage", undefined);
                  }}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base ${
                    !label.logoImage && label.logoEmoji === em ? "border-coral bg-coral-light/20" : "border-sand-200"
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        </Section>
      </div>

      {/* Preview */}
      <div className="flex flex-col items-center justify-start gap-4">
        <div className="flex w-full items-center justify-between rounded-xl border border-sand-200 bg-white px-4 py-2.5">
          <input
            value={label.name}
            onChange={(e) => update("name", e.target.value)}
            className="w-full bg-transparent text-sm font-medium text-cocoa outline-none"
            placeholder="Template name"
          />
        </div>

        <div className="flex min-h-[500px] w-full items-center justify-center rounded-3xl border border-dashed border-sand-300 bg-sand-100 p-6">
          <div
            id="print-label"
            ref={previewRef}
            className="w-full max-w-[340px]"
            style={{ aspectRatio: `${effW} / ${effH}` }}
          >
            <div
              className={`flex h-full w-full flex-col overflow-hidden border-4 ${padClass} text-center shadow-xl ${
                label.shape === "circle" ? "rounded-full" :
                label.shape === "oval" ? "rounded-[50%]" :
                label.shape === "square" ? "rounded-lg" :
                "rounded-3xl"
              }`}
              style={{
                backgroundColor: effectiveBg,
                borderColor: effectiveAccent,
                color: effectiveText,
                fontFamily: effectiveFont,
                containerType: "inline-size",
              }}
            >
              {/* Header: icon + business name */}
              <div className="flex flex-col items-center gap-0.5">
                {label.logoImage ? (
                  <img src={label.logoImage} alt="Logo" crossOrigin="anonymous" className="object-contain" style={{ width: "16cqw", height: "16cqw" }} />
                ) : (
                  <span className="leading-none" style={{ fontSize: "16cqw" }}>{label.logoEmoji}</span>
                )}
                <p
                  className="font-semibold uppercase tracking-widest"
                  style={{ color: effectiveAccent, fontSize: "4.5cqw" }}
                >
                  {effectiveBusinessName}
                </p>
              </div>

              {/* Business identification */}
              <p className="mt-0.5 opacity-65 leading-tight" style={{ fontSize: "3.5cqw" }}>
                {isRegistered
                  ? `${effectivePhone}\u00A0\u00B7\u00A0${effectiveReg || "(reg#)"}`
                  : effectiveAddress
                }
              </p>

              {/* Product name */}
              <p className="mt-1.5 font-bold leading-tight" style={{ fontSize: "11cqw" }}>
                {label.productName || "Product Name"}
              </p>

              {/* Description */}
              {label.details && (
                <p className="mt-1 opacity-70 leading-tight line-clamp-2" style={{ fontSize: "4cqw" }}>
                  {label.details}
                </p>
              )}

              {/* Ingredients */}
              {label.ingredients && (
                <p className="mt-1.5 opacity-65 leading-tight text-left line-clamp-4" style={{ fontSize: "3.5cqw" }}>
                  <span className="font-semibold">Ingredients: </span>
                  {label.ingredients}
                </p>
              )}

              {/* Allergens */}
              {label.allergens && (
                <p className="mt-0.5 font-medium opacity-75 italic leading-tight" style={{ fontSize: "3.5cqw" }}>
                  {label.allergens}
                </p>
              )}

              {/* Spacer */}
              <div className="flex-1 min-h-[2px]" />

              {/* Price + Net weight row */}
              <div className="flex items-center justify-center gap-1.5 font-medium opacity-70" style={{ fontSize: "4.5cqw" }}>
                {label.showPrice && label.price && <span>{label.price}</span>}
                {label.netWeight && (
                  <>
                    {label.showPrice && label.price && <span>\u00B7</span>}
                    <span>{label.netWeight}</span>
                  </>
                )}
              </div>

              {/* Best by */}
              {label.showBestBy && (
                <p className="opacity-60" style={{ fontSize: "3.5cqw" }}>
                  Best by {bestByDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              )}

              {/* MDARD disclaimer */}
              {label.showDisclaimer && (
                <>
                  <div className="my-1.5 h-px w-full opacity-30" style={{ backgroundColor: effectiveText }} />
                  <p
                    className="font-semibold leading-snug"
                    style={{
                      fontSize: `${Math.max(disclaimerCqw, 3.5)}cqw`,
                      color: effectiveText,
                      lineHeight: 1.25,
                    }}
                  >
                    Made in a home kitchen that has not been inspected by the
                    Michigan department of agriculture and rural development.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="grid w-full grid-cols-3 gap-2">
          <button
            onClick={saveTemplate}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-mid-green to-palm py-2.5 text-sm font-medium text-white transition hover:shadow-md"
          >
            <Save size={15} /> Save
          </button>
          <button
            onClick={downloadPng}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-sand-300 py-2.5 text-sm font-medium text-cocoa hover:bg-sand-50"
          >
            <Download size={15} /> PNG
          </button>
          <button
            onClick={printLabel}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-sand-300 py-2.5 text-sm font-medium text-cocoa hover:bg-sand-50"
          >
            <Printer size={15} /> Print
          </button>
        </div>

        {downloadError && (
          <p className="w-full rounded-xl border border-hibiscus/30 bg-hibiscus-light/10 px-4 py-2.5 text-xs text-hibiscus">
            {downloadError}
          </p>
        )}

        {!label.showDisclaimer && (
          <div className="flex w-full items-center gap-2 rounded-xl border border-hibiscus/30 bg-hibiscus-light/10 px-4 py-2.5 text-xs text-hibiscus">
            <AlertTriangle size={14} />
            <span>MDARD disclaimer hidden \u2014 Michigan Cottage Food Law requires this statement on all labels.</span>
          </div>
        )}
      </div>

      {/* Text fields + templates */}
      <div className="space-y-4">
        <Section title="Label text">
          <div className="space-y-2">
            <input
              value={label.businessName}
              onChange={(e) => update("businessName", e.target.value)}
              placeholder="Business name"
              className="input"
            />
            <input
              value={label.productName}
              onChange={(e) => update("productName", e.target.value)}
              placeholder="Product name"
              className="input"
            />
            <textarea
              value={label.details}
              onChange={(e) => update("details", e.target.value)}
              placeholder="Short description"
              rows={2}
              className="input"
            />
            <textarea
              value={label.ingredients}
              onChange={(e) => update("ingredients", e.target.value)}
              placeholder="Ingredients (descending by weight, sub-ingredients in parentheses)"
              rows={3}
              className="input"
            />
            <textarea
              value={label.allergens}
              onChange={(e) => update("allergens", e.target.value)}
              placeholder='Allergens \u2014 e.g. "Contains: wheat, milk, eggs, soy"'
              rows={2}
              className="input"
            />
            <input
              value={label.netWeight}
              onChange={(e) => update("netWeight", e.target.value)}
              placeholder="Net weight (e.g. Net Wt. 3 oz)"
              className="input"
            />
            <div className="flex items-center gap-2">
              <input
                value={label.price}
                onChange={(e) => update("price", e.target.value)}
                placeholder="Price"
                className="input"
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-cocoa-muted">
                <input type="checkbox" checked={label.showPrice} onChange={(e) => update("showPrice", e.target.checked)} />
                Show
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={label.bestByDays}
                onChange={(e) => update("bestByDays", Number(e.target.value))}
                className="input"
                placeholder="Best by (days)"
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-cocoa-muted">
                <input type="checkbox" checked={label.showBestBy} onChange={(e) => update("showBestBy", e.target.checked)} />
                Show
              </label>
            </div>
          </div>
        </Section>

        {/* Business identification */}
        <Section title="Business identification">
          <div className="space-y-2">
            <div className="flex gap-2">
              <button
                onClick={() => update("businessIdMode", "registration")}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium leading-tight ${
                  label.businessIdMode === "registration"
                    ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted"
                }`}
              >
                Name + Phone + Reg #
              </button>
              <button
                onClick={() => update("businessIdMode", "address")}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium leading-tight ${
                  label.businessIdMode === "address"
                    ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted"
                }`}
              >
                Name + Address
              </button>
            </div>

            {isRegistered ? (
              <>
                <input
                  value={label.phoneNumber}
                  onChange={(e) => update("phoneNumber", e.target.value)}
                  placeholder={`Phone (default: ${profile.phone})`}
                  className="input"
                />
                <input
                  value={label.registrationNumber}
                  onChange={(e) => update("registrationNumber", e.target.value)}
                  placeholder={`Registration # (from MSU Product Center)`}
                  className="input"
                />
              </>
            ) : (
              <textarea
                value={label.address}
                onChange={(e) => update("address", e.target.value)}
                placeholder={`Address (default: ${profile.address})`}
                rows={2}
                className="input"
              />
            )}
          </div>
        </Section>

        {/* MDARD disclaimer */}
        <Section title="MDARD disclaimer">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-cocoa">
              <input
                type="checkbox"
                checked={label.showDisclaimer}
                onChange={handleToggleDisclaimer}
              />
              <span>Show required disclaimer</span>
            </label>
            {!label.showDisclaimer && (
              <p className="text-[10px] text-hibiscus font-medium">
                Michigan Cottage Food Law requires this statement on every label.
              </p>
            )}
            {label.showDisclaimer && (
              <p className="text-[10px] text-cocoa-muted">
                Printed at 11pt minimum as required by MCL 289.4102.
              </p>
            )}
          </div>
        </Section>

        <Section title="Saved templates">
          {filterByOrder && orderTemplates && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-coral/10 px-2.5 py-2 text-xs font-medium text-coral">
              <Tag size={12} />
              Showing labels for {filterByOrder}
              {orderTemplates.length === 0 && " — none generated yet"}
            </div>
          )}
          <button onClick={newTemplate} className="mb-2 w-full rounded-lg border border-dashed border-sand-300 py-1.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50">
            + Duplicate as new
          </button>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {labelTemplates.map((t) => {
              const isOrderMatch = filterByOrder && t.name.includes(filterByOrder);
              return (
                <div
                  key={t.id}
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs ${
                    t.id === label.id
                      ? "border-coral bg-coral-light/20"
                      : isOrderMatch
                      ? "border-palm/50 bg-palm/5"
                      : "border-sand-200"
                  }`}
                >
                  <button onClick={() => setLabel(t)} className="flex-1 truncate text-left font-medium text-cocoa-muted">
                    {isOrderMatch && <span className="mr-1 text-palm">🏷️</span>}
                    {t.name}
                  </button>
                  <button onClick={() => removeTemplate(t.id)} className="text-hibiscus hover:text-hibiscus-light">
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </Section>

      </div>

      {/* Disclaimer warning modal */}
      <Modal
        open={showDisclaimerModal}
        onClose={() => setShowDisclaimerModal(false)}
        title="Hide MDARD disclaimer?"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hibiscus-light/20 text-hibiscus">
              <AlertTriangle size={18} />
            </div>
            <div>
              <p className="text-sm font-medium text-cocoa">
                Michigan Cottage Food Law requires this statement
              </p>
              <p className="mt-1 text-xs text-cocoa-muted leading-relaxed">
                Per MCL 289.4102(3)(g), every cottage food label must include the
                following statement printed in at least 11-point font with clear
                contrast to the background:
              </p>
              <p className="mt-2 text-[11px] italic text-cocoa-muted bg-sand-100 rounded-lg p-2.5">
                &ldquo;Made in a home kitchen that has not been inspected by the
                Michigan department of agriculture and rural development.&rdquo;
              </p>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowDisclaimerModal(false)}
              className="rounded-lg border border-sand-200 px-4 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
            >
              Keep disclaimer
            </button>
            <button
              onClick={confirmHideDisclaimer}
              className="rounded-lg bg-hibiscus px-4 py-2 text-xs font-medium text-white hover:bg-hibiscus-light"
            >
              Hide anyway
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-4 shadow-sm">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-cocoa-muted">{title}</p>
      {children}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 cursor-pointer rounded border-none bg-transparent" />
      <span className="text-[10px] text-cocoa-muted">{label}</span>
    </div>
  );
}
