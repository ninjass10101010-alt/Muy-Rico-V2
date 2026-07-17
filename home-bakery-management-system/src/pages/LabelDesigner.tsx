import { useRef, useState, useCallback, useEffect } from "react";
import { toPng, toJpeg } from "html-to-image";
import { jsPDF } from "jspdf";
import {
  Download,
  Printer,
  Save,
  Tag,
  Trash2,
  AlertTriangle,
  Upload,
  X,
  RectangleVertical,
  RectangleHorizontal,
  Image as ImageIcon,
} from "lucide-react";
import { useStore } from "../context/StoreContext";
import { newId } from "../utils/format";
import Modal from "../components/ui/Modal";
import type { LabelElement, LabelShape, LabelTemplate } from "../types";
import LabelCanvas from "../components/label/LabelCanvas";
import LayersPanel from "../components/label/LayersPanel";
import PropertiesInspector from "../components/label/PropertiesInspector";
import ComplianceChecklist from "../components/label/ComplianceChecklist";
import ComplianceScore from "../components/label/ComplianceScore";
import FontCompliancePanel from "../components/label/FontCompliancePanel";
import AllergenPicker from "../components/label/AllergenPicker";
import IngredientSorter from "../components/label/IngredientSorter";
import ProductTypeSelector from "../components/label/ProductTypeSelector";
import NetWeightInput from "../components/label/NetWeightInput";
import MILawReference from "../components/label/MILawReference";
import ColorInput from "../components/label/ColorInput";
import ShapePalette from "../components/label/ShapePalette";
import UndoRedoBar from "../components/label/UndoRedoBar";
import AverySheet from "../components/label/AverySheet";
import NutritionFactsPanel from "../components/label/NutritionFactsPanel";
import {
  defaultElementsFor,
  effectiveDimensions,
  ensureElements,
  defaultNfpElement,
  defaultShapeElement,
} from "../components/label/defaultElements";

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
  { value: "rounded", label: "Rounded Rectangle" },
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

const MAX_UNDO = 50;

function makeFallback(profileWebsite: string): LabelTemplate {
  const base: LabelTemplate = {
    id: "new",
    name: "New Label",
    shape: "rounded",
    bgColor: "#FBF3E7",
    accentColor: "#C17A3F",
    textColor: "#4A3222",
    businessName: "",
    productName: "",
    details: "",
    ingredients: "",
    allergens: "",
    netWeight: "",
    netWeightUS: "",
    netWeightMetric: "",
    price: "",
    showPrice: false,
    showBestBy: false,
    bestByDays: 7,
    logoEmoji: "🧁",
    font: "'Cormorant Garamond', Georgia, serif",
    businessIdMode: "address",
    address: "",
    phoneNumber: "",
    registrationNumber: "",
    showDisclaimer: true,
    labelWidth: 3,
    labelHeight: 4,
    orientation: "portrait",
    websiteUrl: profileWebsite || "https://muy-rico.com",
    elements: [],
    disclaimerVariant: "standard",
    productType: "standard",
    allergenTags: [],
    noAllergensConfirmed: false,
    nutrientClaim: false,
    averyPreset: "single",
  };
  return { ...base, elements: defaultElementsFor(base) };
}

export default function LabelDesigner({ filterByOrder }: { filterByOrder?: string | null }) {
  const {
    labelTemplates,
    handleCreateLabel,
    handleUpdateLabel,
    handleDeleteLabel,
    products,
    profile,
  } = useStore();

  const orderTemplates = filterByOrder
    ? labelTemplates.filter((t) => t.name.includes(filterByOrder))
    : null;

  const [label, setLabelState] = useState<LabelTemplate>(() => {
    const src =
      (orderTemplates && orderTemplates.length > 0 ? orderTemplates[0] : labelTemplates[0]) ||
      makeFallback(profile.website);
    return normalizeLabel(src, profile.website);
  });

  const [past, setPast] = useState<LabelTemplate[]>([]);
  const [future, setFuture] = useState<LabelTemplate[]>([]);
  const [zoom, setZoom] = useState(1);
  const previewRef = useRef<HTMLDivElement>(null);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customW, setCustomW] = useState(String(label.labelWidth));
  const [customH, setCustomH] = useState(String(label.labelHeight));
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Onboarding on first launch
  useEffect(() => {
    const onboarded = localStorage.getItem("muyrico.labelstudio.onboarded");
    if (!onboarded && (!profile.name || profile.name === "Muy Rico")) {
      setShowOnboarding(true);
    }
  }, [profile.name]);

  function commit(next: LabelTemplate) {
    setLabelState((prev) => {
      setPast((p) => {
        const updated = [...p, prev];
        return updated.length > MAX_UNDO ? updated.slice(-MAX_UNDO) : updated;
      });
      setFuture([]);
      return next;
    });
  }

  function setLabel(next: LabelTemplate | ((prev: LabelTemplate) => LabelTemplate)) {
    if (typeof next === "function") {
      setLabelState((prev) => {
        const result = next(prev);
        setPast((p) => {
          const updated = [...p, prev];
          return updated.length > MAX_UNDO ? updated.slice(-MAX_UNDO) : updated;
        });
        setFuture([]);
        return result;
      });
    } else {
      commit(next);
    }
  }

  function undo() {
    setLabelState((cur) => {
      const prev = past[past.length - 1];
      if (!prev) return cur;
      setPast((p) => p.slice(0, -1));
      setFuture((f) => [...f, cur]);
      return prev;
    });
  }

  function redo() {
    setLabelState((cur) => {
      const next = future[future.length - 1];
      if (!next) return cur;
      setFuture((f) => f.slice(0, -1));
      setPast((p) => [...p, cur]);
      return next;
    });
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (e.shiftKey) { redo(); return; }
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y")) {
        redo();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [past, future]);

  function update<K extends keyof LabelTemplate>(key: K, value: LabelTemplate[K]) {
    setLabelState((l) => {
      const next = { ...l, [key]: value };
      // Keep disclaimer element visibility in sync
      if (key === "showDisclaimer") {
        next.elements = ensureElements(next).map((el) =>
          el.field === "disclaimer" || el.field === "divider"
            ? { ...el, hidden: !value }
            : el
        );
      }
      return next;
    });
  }

  function setElements(elements: LabelElement[]) {
    setLabel((l) => ({ ...l, elements }));
  }

  function applyPreset(preset: (typeof COLOR_PRESETS)[number]) {
    update("bgColor", preset.bg);
    update("accentColor", preset.accent);
    update("textColor", preset.text);
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
    const toSave = normalizeLabel(label, profile.website);
    const exists = labelTemplates.find((t) => t.id === toSave.id);
    if (exists) {
      await handleUpdateLabel(toSave.id, toSave);
    } else {
      const saved = { ...toSave, id: newId("label") };
      await handleCreateLabel(saved);
      commit(saved);
    }
  }

  async function newTemplate() {
    const fresh: LabelTemplate = {
      ...normalizeLabel(label, profile.website),
      id: newId("label"),
      name: "Untitled Label",
    };
    await handleCreateLabel(fresh);
    commit(fresh);
  }

  function removeTemplate(id: string) {
    handleDeleteLabel(id);
    if (label.id === id && labelTemplates.length > 1) {
      commit(normalizeLabel(labelTemplates.find((t) => t.id !== id)!, profile.website));
    }
  }

  function handleToggleDisclaimer() {
    if (label.showDisclaimer) setShowDisclaimerModal(true);
    else update("showDisclaimer", true);
  }

  function confirmHideDisclaimer() {
    update("showDisclaimer", false);
    setShowDisclaimerModal(false);
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setDownloadError("Image must be under 5MB");
      return;
    }
    if (!["image/png", "image/jpeg", "image/svg+xml"].includes(file.type)) {
      setDownloadError("Only PNG, JPG, and SVG images are accepted");
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result) {
        if (e.target.dataset.field === "bgImage") {
          update("bgImage", event.target.result as string);
        } else {
          update("logoImage", event.target.result as string);
        }
      }
    };
    reader.readAsDataURL(file);
  }

  function handleBgImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    handleImageUpload(e as never);
  }

  const { effW, effH } = effectiveDimensions(
    label.labelWidth,
    label.labelHeight,
    label.shape,
    label.orientation || "portrait"
  );
  const isSquareShape = label.shape === "circle" || label.shape === "square";
  const logoSize = label.logoSize ?? 16;
  const hasLogo = Boolean(label.logoImage) || Boolean(label.logoEmoji);
  const isRegistered = label.businessIdMode === "registration";
  const elements = ensureElements(label);
  const selected = elements.find((e) => e.id === selectedId) || null;

  const downloadPng = useCallback(async () => {
    if (!previewRef.current) return;
    setDownloadError(null);
    const el = previewRef.current;
    const rect = el.getBoundingClientRect();
    const targetWidth = effW * 300;
    const dpr = rect.width ? targetWidth / rect.width : 1;

    const imgs = Array.from(el.querySelectorAll("img"));
    await Promise.all(
      imgs.map(
        (img) =>
          new Promise<void>((resolve) => {
            if (!img.src || img.src.startsWith("data:")) return resolve();
            const test = new Image();
            test.crossOrigin = "anonymous";
            test.onload = () => { img.crossOrigin = "anonymous"; resolve(); };
            test.onerror = () => resolve();
            test.src = img.src;
          })
      )
    );

    const filter = (node: HTMLElement) =>
      !(node.classList && node.classList.contains("deco-layer"));

    let dataUrl: string | null = null;
    try {
      dataUrl = await toPng(el, { pixelRatio: dpr, cacheBust: true, filter });
    } catch (fontErr) {
      console.warn("PNG font retry:", fontErr);
      try {
        dataUrl = await toPng(el, { pixelRatio: dpr, cacheBust: true, skipFonts: true, filter });
      } catch (err) {
        console.error("PNG export failed:", err);
        setDownloadError("Could not export the label image. Try removing an uploaded logo or re-uploading it.");
        return;
      }
    }
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.download = `${label.productName || "label"}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [effW, label.productName]);

  const downloadJpg = useCallback(async () => {
    if (!previewRef.current) return;
    const el = previewRef.current;
    const rect = el.getBoundingClientRect();
    const dpr = rect.width ? (effW * 300) / rect.width : 1;
    const filter = (node: HTMLElement) =>
      !(node.classList && node.classList.contains("deco-layer"));
    try {
      const dataUrl = await toJpeg(el, { pixelRatio: dpr, quality: 0.95, cacheBust: true, filter });
      const link = document.createElement("a");
      link.download = `${label.productName || "label"}.jpg`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("JPG export failed:", err);
    }
  }, [effW, label.productName]);

  const downloadPdf = useCallback(async () => {
    if (!previewRef.current) return;
    setDownloadError(null);
    const el = previewRef.current;
    const rect = el.getBoundingClientRect();
    const dpr = rect.width ? (effW * 300) / rect.width : 1;
    const filter = (node: HTMLElement) =>
      !(node.classList && node.classList.contains("deco-layer"));
    try {
      const dataUrl = await toPng(el, { pixelRatio: dpr, cacheBust: true, filter, skipFonts: true });
      const pdf = new jsPDF({ unit: "in", format: [effW, effH] });
      pdf.addImage(dataUrl, "PNG", 0, 0, effW, effH);
      pdf.save(`${label.productName || "label"}.pdf`);
    } catch (err) {
      console.error("PDF export failed:", err);
      setDownloadError("PDF export failed. Try downloading PNG instead.");
    }
  }, [effW, label.productName]);

  function printLabel(preset: string = "single") {
    document.body.classList.remove("avery-5164", "avery-5163", "avery-8163");
    if (preset !== "single") document.body.classList.add(`avery-${preset}`);
    window.print();
    document.body.classList.remove("avery-5164", "avery-5163", "avery-8163");
  }

  function addShape(type: LabelElement["type"]) {
    const shape = defaultShapeElement(type as "rect" | "circle" | "line");
    const newEl: LabelElement = {
      id: newId("el"),
      type: type as LabelElement["type"],
      field: "shape",
      x: 0.2,
      y: 0.2,
      w: 0.3,
      h: 0.3,
      z: (Math.max(...elements.map((e) => e.z), 0) + 1),
      rotation: 0,
      hidden: false,
      strokeColor: shape.strokeColor,
      strokeWidth: shape.strokeWidth,
      fillColor: shape.fillColor,
    };
    setElements([...elements, newEl]);
    setSelectedId(newEl.id);
  }

  function addNfp() {
    const nfp = defaultNfpElement();
    const newEl: LabelElement = {
      ...nfp,
      id: newId("el"),
      z: Math.max(...elements.map((e) => e.z), 0) + 1,
    };
    setElements([...elements, newEl]);
    setSelectedId(newEl.id);
  }

  function focusFixTarget(target: string) {
    const el = document.querySelector(`[data-fix-target="${target}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof (el as HTMLInputElement).focus === "function") {
      window.setTimeout(() => (el as HTMLInputElement).focus(), 250);
    }
  }

  function onComplianceFix(issueId: string, fieldName: string, elementId?: string) {
    if (issueId === "disclaimer-hidden" || fieldName === "showDisclaimer") {
      update("showDisclaimer", true);
      return;
    }
    if (issueId === "disclaimer-font" || issueId === "disclaimer-contrast") {
      if (elementId) setSelectedId(elementId);
      else {
        const disc = elements.find((e) => e.field === "disclaimer");
        if (disc) setSelectedId(disc.id);
      }
      return;
    }
    if (issueId === "nfp-missing") {
      focusFixTarget("nfp");
      return;
    }
    if (issueId === "biz-name" || fieldName === "businessName") {
      focusFixTarget("businessName");
      return;
    }
    if (issueId === "product-name" || fieldName === "productName") {
      focusFixTarget("productName");
      return;
    }
    if (issueId === "ingredients" || fieldName === "ingredients") {
      focusFixTarget("ingredients");
      return;
    }
    if (issueId === "allergens" || fieldName === "allergens") {
      focusFixTarget("allergens");
      return;
    }
    if (issueId === "net-weight" || fieldName === "netWeightUS") {
      focusFixTarget("netWeightUS");
      return;
    }
    if (issueId === "biz-address" || issueId === "biz-pobox" || fieldName === "address") {
      focusFixTarget("address");
      return;
    }
    if (issueId === "biz-phone" || fieldName === "phoneNumber") {
      focusFixTarget("phoneNumber");
      return;
    }
    if (issueId === "biz-reg" || fieldName === "registrationNumber") {
      focusFixTarget("registrationNumber");
      return;
    }
    if (elementId) setSelectedId(elementId);
  }

  function onSelectElement(elementId: string) {
    setSelectedId(elementId);
  }

  function changeShape(nextShape: LabelShape) {
    const prev = effectiveDimensions(
      label.labelWidth,
      label.labelHeight,
      label.shape,
      label.orientation || "portrait"
    );
    const next = effectiveDimensions(
      label.labelWidth,
      label.labelHeight,
      nextShape,
      label.orientation || "portrait"
    );
    const els = ensureElements(label);
    const fitted = fitElementsToAspect(els, prev.effW / prev.effH, next.effW / next.effH);
    setLabel({ ...label, shape: nextShape, elements: fitted });
  }

  function patchElement(id: string, patch: Partial<LabelElement>) {
    setElements(elements.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function reorderElements(elementIds: string[]) {
    const reordered = elementIds
      .map((id, i) => ({ id, z: elementIds.length - i }))
      .reduce((acc, { id, z }) => {
        const el = elements.find((e) => e.id === id);
        if (el) acc.push({ ...el, z });
        return acc;
      }, [] as LabelElement[]);
    // Add any elements not in the reorder list
    const idsSet = new Set(elementIds);
    const remaining = elements.filter((e) => !idsSet.has(e.id));
    setElements([...reordered, ...remaining]);
  }

  return (
    <>
      {/* Onboarding modal */}
      {showOnboarding && (
        <OnboardingModal
          profile={profile}
          onSave={async (draft) => {
            await handleUpdateProfile(draft);
            localStorage.setItem("muyrico.labelstudio.onboarded", "1");
            setShowOnboarding(false);
          }}
          onSkip={() => {
            localStorage.setItem("muyrico.labelstudio.onboarded", "1");
            setShowOnboarding(false);
          }}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr_300px]">
        {/* ========== LEFT: Controls ========== */}
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

          <Section title="Product type">
            <ProductTypeSelector value={label.productType} onChange={(v) => update("productType", v)} />
          </Section>

          <Section title="Shape & decoration">
            <div className="grid grid-cols-2 gap-2">
              {SHAPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => changeShape(s.value)}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                    label.shape === s.value
                      ? "border-palm bg-palm text-white"
                      : "border-sand-200 text-cocoa-muted"
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
                  onClick={() => {
                    update("labelWidth", s.w);
                    update("labelHeight", s.h);
                    setCustomW(String(s.w));
                    setCustomH(String(s.h));
                  }}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                    label.labelWidth === s.w && label.labelHeight === s.h
                      ? "border-palm bg-palm text-white"
                      : "border-sand-200 text-cocoa-muted"
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
                  update("labelWidth", n);
                  setCustomW(String(n));
                }}
                className="input w-16 text-xs"
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
                  update("labelHeight", n);
                  setCustomH(String(n));
                }}
                className="input w-16 text-xs"
              />
              <span className="text-[10px] text-cocoa-muted">in</span>
            </div>

            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={isSquareShape}
                onClick={() => update("orientation", "portrait")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium ${
                  (label.orientation || "portrait") === "portrait" && !isSquareShape
                    ? "border-palm bg-palm text-white"
                    : "border-sand-200 text-cocoa-muted"
                } disabled:opacity-40`}
              >
                <RectangleVertical size={14} /> Portrait
              </button>
              <button
                type="button"
                disabled={isSquareShape}
                onClick={() => update("orientation", "landscape")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium ${
                  label.orientation === "landscape" && !isSquareShape
                    ? "border-palm bg-palm text-white"
                    : "border-sand-200 text-cocoa-muted"
                } disabled:opacity-40`}
              >
                <RectangleHorizontal size={14} /> Landscape
              </button>
            </div>
          </Section>

          <Section title="Website & QR">
            <input
              value={label.websiteUrl}
              onChange={(e) => update("websiteUrl", e.target.value)}
              placeholder={profile.website || "https://muy-rico.com"}
              className="input"
            />
            <label className="mt-2 flex items-center gap-2 text-xs text-cocoa">
              <input
                type="checkbox"
                checked={!elements.find((e) => e.field === "qr")?.hidden}
                onChange={(e) => {
                  const qr = elements.find((el) => el.field === "qr");
                  if (qr) {
                    setElements(
                      elements.map((el) =>
                        el.field === "qr" ? { ...el, hidden: !e.target.checked } : el
                      )
                    );
                  }
                }}
              />
              Show QR code on this label
            </label>
          </Section>

          <Section title="Background image">
            <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-sand-300 py-2 text-xs font-medium text-cocoa hover:bg-sand-50">
              <ImageIcon size={14} /> Upload background
              <input
                type="file"
                accept="image/*"
                className="hidden"
                data-field="bgImage"
                onChange={handleBgImageUpload}
              />
            </label>
            {label.bgImage && (
              <button
                type="button"
                onClick={() => update("bgImage", undefined)}
                className="mt-1 w-full rounded border border-hibiscus/30 px-2 py-1 text-[10px] text-hibiscus hover:bg-hibiscus-light/10"
              >
                Clear background image
              </button>
            )}
          </Section>

          <Section title="Color palette">
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
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
            <select value={label.font} onChange={(e) => update("font", e.target.value)} className="input">
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
                <button
                  type="button"
                  onClick={() => { update("logoImage", undefined); update("logoEmoji", ""); }}
                  className={`flex items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium ${
                    !hasLogo
                      ? "border-coral bg-coral-light/20 text-coral"
                      : "border-sand-300 text-cocoa-muted hover:bg-sand-50"
                  }`}
                >
                  None
                </button>
                {label.logoImage && (
                  <button
                    type="button"
                    onClick={() => update("logoImage", undefined)}
                    className="flex items-center justify-center rounded-lg border border-hibiscus/30 px-3 py-2 text-hibiscus hover:bg-hibiscus-light/10"
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
                    onClick={() => { update("logoEmoji", em); update("logoImage", undefined); }}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base ${
                      !label.logoImage && label.logoEmoji === em
                        ? "border-coral bg-coral-light/20"
                        : "border-sand-200"
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
                  onChange={(e) => update("logoSize", Number(e.target.value))}
                  className="flex-1 accent-coral"
                />
                <span className="w-8 text-right text-[10px] tabular-nums text-cocoa-muted">{logoSize}</span>
              </div>
            </div>
          </Section>

          <Section title="Add element">
            <ShapePalette onAdd={addShape} />
            <button
              type="button"
              data-fix-target="nfp"
              onClick={addNfp}
              className="mt-2 w-full rounded-lg border border-dashed border-sand-300 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
            >
              + Add Nutrition Facts panel
            </button>
          </Section>

          <AverySheet
            averyPreset={label.averyPreset}
            onChange={(p) => update("averyPreset", p as never)}
            onPrint={printLabel}
          />
        </div>

        {/* ========== CENTER: Canvas ========== */}
        <div className="flex flex-col items-center justify-start gap-2">
          <div className="flex w-full items-center justify-between rounded-xl border border-sand-200 bg-white px-4 py-2.5">
            <input
              value={label.name}
              onChange={(e) => update("name", e.target.value)}
              className="w-full bg-transparent text-sm font-medium text-cocoa outline-none"
              placeholder="Template name"
            />
          </div>

          {/* Undo/Redo + Compliance score row */}
          <div className="flex w-full items-center justify-between">
            <UndoRedoBar
              canUndo={past.length > 0}
              canRedo={future.length > 0}
              onUndo={undo}
              onRedo={redo}
            />
            <ComplianceScore label={normalizeLabel(label, profile.website)} profile={profile} />
          </div>

          <LabelCanvas
            label={normalizeLabel(label, profile.website)}
            profile={profile}
            onChangeElements={setElements}
            onUpdateField={update}
            previewRef={previewRef}
            selectedId={selectedId}
            onSelect={setSelectedId}
            zoom={zoom}
            onZoomChange={setZoom}
          />

          {/* Export buttons */}
          <div className="grid w-full grid-cols-5 gap-2">
            <button
              type="button"
              onClick={saveTemplate}
              className="col-span-1 flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-mid-green to-palm py-2.5 text-sm font-medium text-white transition hover:shadow-md"
            >
              <Save size={15} /> Save
            </button>
            <button
              type="button"
              onClick={downloadPng}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-sand-300 py-2.5 text-sm font-medium text-cocoa hover:bg-sand-50"
            >
              <Download size={15} /> PNG
            </button>
            <button
              type="button"
              onClick={downloadJpg}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-sand-300 py-2.5 text-sm font-medium text-cocoa hover:bg-sand-50"
            >
              <Download size={15} /> JPG
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-sand-300 py-2.5 text-sm font-medium text-cocoa hover:bg-sand-50"
            >
              <Download size={15} /> PDF
            </button>
            <button
              type="button"
              onClick={() => printLabel(label.averyPreset)}
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
              <span>MDARD disclaimer hidden — Michigan Cottage Food Law requires this statement on all labels.</span>
            </div>
          )}
        </div>

        {/* ========== RIGHT: Compliance + Layers + Inspector ========== */}
        <div className="space-y-4">
          {/* Compliance score */}
          <Section title="Compliance checklist">
            <ComplianceChecklist
              label={normalizeLabel(label, profile.website)}
              profile={profile}
              onFix={onComplianceFix}
              onSelectElement={onSelectElement}
            />
          </Section>

          {/* Font compliance */}
          <Section title="Font size compliance">
            <FontCompliancePanel
              label={normalizeLabel(label, profile.website)}
              effW={effW}
              onFix={(id, cqw) => patchElement(id, { fontSizeOverride: cqw })}
            />
          </Section>

          {/* Label text inputs */}
          <Section title="Label text">
            <div className="space-y-2">
              <input
                data-fix-target="businessName"
                value={label.businessName || profile.name}
                onChange={(e) => update("businessName", e.target.value)}
                placeholder="Business name"
                className="input"
              />
              <input
                data-fix-target="productName"
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
              <div data-fix-target="ingredients">
                <IngredientSorter
                  value={label.ingredients}
                  onChange={(v) => update("ingredients", v)}
                />
              </div>
              <div data-fix-target="allergens">
                <AllergenPicker
                  value={label.allergenTags}
                  noAllergensConfirmed={label.noAllergensConfirmed}
                  onChange={(tags) => update("allergenTags", tags)}
                  onNoAllergens={(v) => update("noAllergensConfirmed", v)}
                  ingredientsText={label.ingredients}
                />
              </div>
              <input
                value={label.netWeight}
                onChange={(e) => update("netWeight", e.target.value)}
                placeholder="Net weight (backward compat)"
                className="input"
              />
              <div data-fix-target="netWeightUS">
                <NetWeightInput
                  netWeightUS={label.netWeightUS}
                  netWeightMetric={label.netWeightMetric}
                  onChange={(us, metric) => {
                    update("netWeightUS", us);
                    update("netWeightMetric", metric);
                  }}
                />
              </div>
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
              <label className="flex items-center gap-2 text-xs text-cocoa-muted">
                <input
                  type="checkbox"
                  checked={label.nutrientClaim}
                  onChange={(e) => update("nutrientClaim", e.target.checked)}
                />
                This product uses a nutrient content claim (e.g., "low fat", "sugar free")
              </label>
              {label.nutrientClaim && (
                <p className="text-[10px] text-hibiscus">
                  Using health/nutrient claims removes your exemption from full nutrition labeling (21 CFR §101.2).
                </p>
              )}
            </div>
          </Section>

          <Section title="Business identification">
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => update("businessIdMode", "registration")}
                  className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium leading-tight ${
                    label.businessIdMode === "registration"
                      ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted"
                  }`}
                >
                  Name + Phone + Reg #
                </button>
                <button
                  type="button"
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
                    data-fix-target="phoneNumber"
                    value={label.phoneNumber || profile.phone}
                    onChange={(e) => update("phoneNumber", e.target.value)}
                    placeholder="Phone"
                    className="input"
                  />
                  <input
                    data-fix-target="registrationNumber"
                    value={label.registrationNumber || profile.registrationNumber}
                    onChange={(e) => update("registrationNumber", e.target.value)}
                    placeholder="Registration # (from MSU Product Center)"
                    className="input"
                  />
                </>
              ) : (
                <textarea
                  data-fix-target="address"
                  value={label.address || profile.address}
                  onChange={(e) => update("address", e.target.value)}
                  placeholder={`Address (default: ${profile.address})`}
                  rows={2}
                  className="input"
                />
              )}
              <label className="flex items-center gap-2 text-xs text-cocoa-muted">
                <input
                  type="checkbox"
                  checked={label.businessIdMode === "registration"}
                  onChange={(e) => update("businessIdMode", e.target.checked ? "registration" : "address")}
                />
                Use MSU Registration Number (hides home address — MCL 289.4102(8)(9))
              </label>
            </div>
          </Section>

          <Section title="MDARD disclaimer">
            <label className="flex items-center gap-2 text-xs text-cocoa">
              <input type="checkbox" checked={label.showDisclaimer} onChange={handleToggleDisclaimer} />
              <span>Show required disclaimer</span>
            </label>
            {!label.showDisclaimer && (
              <p className="mt-1 text-[10px] font-medium text-hibiscus">
                Michigan Cottage Food Law requires this statement on every label.
              </p>
            )}
          </Section>

          <Section title="Layers">
            <LayersPanel
              elements={elements}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onToggleHide={(id) => {
                const el = elements.find((e) => e.id === id);
                if (!el) return;
                if (el.field === "disclaimer") update("showDisclaimer", el.hidden);
                patchElement(id, { hidden: !el.hidden });
              }}
              onToggleLock={(id) => {
                const el = elements.find((e) => e.id === id);
                if (el) patchElement(id, { lock: !el.lock });
              }}
              onReorder={reorderElements}
            />
          </Section>

          {selected && (
            <Section title="Element properties">
              <PropertiesInspector el={selected} label={label} onChange={(patch) => patchElement(selected.id, patch)} />
            </Section>
          )}

          <Section title="Saved templates">
            {filterByOrder && orderTemplates && (
              <div className="mb-2 flex items-center gap-2 rounded-lg bg-coral/10 px-2.5 py-2 text-xs font-medium text-coral">
                <Tag size={12} />
                Showing labels for {filterByOrder}
                {orderTemplates.length === 0 && " — none generated yet"}
              </div>
            )}
            <button
              type="button"
              onClick={newTemplate}
              className="mb-2 w-full rounded-lg border border-dashed border-sand-300 py-1.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
            >
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
                    <button
                      type="button"
                      onClick={() => {
                        commit(normalizeLabel(t, profile.website));
                        setSelectedId(null);
                        setCustomW(String(t.labelWidth || 3));
                        setCustomH(String(t.labelHeight || 4));
                      }}
                      className="flex-1 truncate text-left font-medium text-cocoa-muted"
                    >
                      {isOrderMatch && <span className="mr-1">🏷️</span>}
                      {t.name}
                    </button>
                    <button type="button" onClick={() => removeTemplate(t.id)} className="text-hibiscus hover:text-hibiscus-light">
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </Section>

          <MILawReference />
        </div>
      </div>

      {/* Disclaimer warning modal */}
      <Modal open={showDisclaimerModal} onClose={() => setShowDisclaimerModal(false)} title="Hide MDARD disclaimer?">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-hibiscus-light/20 text-hibiscus">
              <AlertTriangle size={18} />
            </div>
            <div>
              <p className="text-sm font-medium text-cocoa">Michigan Cottage Food Law requires this statement</p>
              <p className="mt-1 text-xs leading-relaxed text-cocoa-muted">
                Per MCL 289.4102(3)(g), every cottage food label must include the following statement
                printed in at least 11-point font with clear contrast to the background:
              </p>
              <p className="mt-2 rounded-lg bg-sand-100 p-2.5 text-[11px] italic text-cocoa-muted">
                &ldquo;Made in a home kitchen that has not been inspected by the Michigan
                Department of Agriculture and Rural Development.&rdquo;
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowDisclaimerModal(false)}
              className="rounded-lg border border-sand-200 px-4 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50">
              Keep disclaimer
            </button>
            <button type="button" onClick={confirmHideDisclaimer}
              className="rounded-lg bg-hibiscus px-4 py-2 text-xs font-medium text-white hover:bg-hibiscus-light">
              Hide anyway
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function normalizeLabel(t: LabelTemplate, profileWebsite: string): LabelTemplate {
  return {
    ...t,
    orientation: t.orientation || "portrait",
    websiteUrl: t.websiteUrl || profileWebsite || "https://muy-rico.com",
    elements: t.elements && t.elements.length > 0 ? t.elements : defaultElementsFor(t),
    showDisclaimer: t.showDisclaimer !== false,
    disclaimerVariant: "standard",
    productType: t.productType === "wedding" ? "wedding" : "standard",
    allergenTags: t.allergenTags || [],
    noAllergensConfirmed: Boolean(t.noAllergensConfirmed),
    nutrientClaim: Boolean(t.nutrientClaim),
    averyPreset: t.averyPreset || "single",
    netWeightUS: t.netWeightUS || "",
    netWeightMetric: t.netWeightMetric || "",
  };
}

/** Scale/clamp elements so they fit after a shape/aspect-ratio change. Only scales if overflow. */
function fitElementsToAspect(
  elements: LabelElement[],
  _oldAspect: number,
  _newAspect: number
): LabelElement[] {
  let maxRight = 0;
  let maxBottom = 0;
  for (const el of elements) {
    maxRight = Math.max(maxRight, el.x + el.w);
    maxBottom = Math.max(maxBottom, el.y + el.h);
  }
  if (maxRight <= 1 && maxBottom <= 1) return elements;

  const scale = Math.min(1 / Math.max(maxRight, 0.001), 1 / Math.max(maxBottom, 0.001), 1);
  return elements.map((el) => {
    const w = Math.min(el.w * scale, 1);
    const h = Math.min(el.h * scale, 1);
    const x = Math.min(Math.max(el.x * scale, 0), 1 - w);
    const y = Math.min(Math.max(el.y * scale, 0), 1 - h);
    return { ...el, x, y, w, h };
  });
}

function OnboardingModal({
  profile,
  onSave,
  onSkip,
}: {
  profile: import("../types").BusinessProfile;
  onSave: (d: import("../types").BusinessProfile) => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({ ...profile });
  const steps = [
    {
      title: "Welcome to Label Studio",
      content: (
        <p className="text-xs text-cocoa-muted leading-relaxed">
          This tool helps you create Michigan Cottage Food Law-compliant labels (MCL 289.4102).
          Let&apos;s set up your business profile first. You can change these anytime in Settings.
        </p>
      ),
    },
    {
      title: "Business Type",
      content: (
        <div className="flex flex-col gap-2">
          {(["cottage", "licensed"] as const).map((bt) => (
            <button
              key={bt}
              type="button"
              onClick={() => setDraft((d) => ({ ...d, businessType: bt }))}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                draft.businessType === bt
                  ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted"
              }`}
            >
              {bt === "cottage" ? "Cottage Food Producer" : "Licensed Food Processor"}
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Business Name & Contact",
      content: (
        <div className="space-y-2">
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Business name"
            className="input"
          />
          <input
            value={draft.phone}
            onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
            placeholder="Phone number"
            className="input"
          />
          <input
            value={draft.email}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            placeholder="Email"
            className="input"
          />
          <input
            value={draft.website}
            onChange={(e) => setDraft((d) => ({ ...d, website: e.target.value }))}
            placeholder="Website (https://muy-rico.com)"
            className="input"
          />
        </div>
      ),
    },
    {
      title: "Address or MSU Registration",
      content: (
        <div className="space-y-2">
          <textarea
            value={draft.address}
            onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
            placeholder="Physical street address (no P.O. Box)"
            rows={2}
            className="input"
          />
          <input
            value={draft.registrationNumber}
            onChange={(e) => setDraft((d) => ({ ...d, registrationNumber: e.target.value }))}
            placeholder="MSU Product Center registration number (optional)"
            className="input"
          />
          <p className="text-[10px] text-cocoa-muted">
            If you have an MSU registration number, it replaces your home address on labels (MCL 289.4102).
          </p>
        </div>
      ),
    },
    {
      title: "Ready!",
      content: (
        <p className="text-xs text-cocoa-muted leading-relaxed">
          Your profile is set up. You can now create labels with all Michigan compliance features
          automatically validated. Start by clicking &quot;New Label&quot; or loading a saved template.
        </p>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-palm/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-[40px_12px_40px_12px] bg-white p-6 shadow-2xl">
        <h2 className="mb-1 font-serif text-lg font-bold text-cocoa">{steps[step].title}</h2>
        <div className="mb-4">{steps[step].content}</div>
        <div className="flex items-center justify-between">
          <button type="button" onClick={onSkip} className="text-[11px] text-cocoa-muted underline">Skip</button>
          <div className="flex items-center gap-2">
            {steps.map((_, i) => (
              <div key={i} className={`h-1.5 w-1.5 rounded-full ${i === step ? "bg-coral" : "bg-sand-200"}`} />
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              if (step < steps.length - 1) setStep((s) => s + 1);
              else onSave(draft);
            }}
            className="rounded-lg bg-gradient-to-r from-mid-green to-palm px-4 py-2 text-xs font-medium text-white"
          >
            {step < steps.length - 1 ? "Next" : "Start Designing"}
          </button>
        </div>
      </div>
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
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 cursor-pointer rounded border-none bg-transparent"
      />
      <span className="text-[10px] text-cocoa-muted">{label}</span>
    </div>
  );
}
