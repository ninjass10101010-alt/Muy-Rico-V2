import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileImage,
  FileText,
  Image as ImageIcon,
  Layers,
  LayoutTemplate,
  Maximize,
  Plus,
  Printer,
  Redo2,
  Save,
  Share2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { LabelElement, LabelTemplate } from "../../types";
import { effectiveDimensions } from "../../components/label/defaultElements";
import ComplianceScore from "../../components/label/ComplianceScore";
import Modal from "../../components/ui/Modal";
import { useStore } from "../../context/StoreContext";
import { newId } from "../../utils/format";
import StageCanvas from "./StageCanvas";
import { makeFallback, normalizeLabel } from "./templateUtils";
import { selectCanRedo, selectCanUndo, useEditorStore } from "./state";
import type { LeftTab } from "./state";
import CompliancePanel from "./panels/CompliancePanel";
import AddTab from "./panels/AddTab";
import LayersTab from "./panels/LayersTab";
import TemplatesTab from "./panels/TemplatesTab";
import OnboardingModal from "./OnboardingModal";

const DRAFT_KEY = "muyrico.labelstudio.draft";
const COALESCE_MS = 600;
const ZOOM_STEP = 25;

interface Props {
  filterByOrder?: string | null;
  filterByProduct?: string | null;
  returnToLabel?: string;
  onBack: () => void;
}

const TOOL_BTN =
  "flex items-center justify-center rounded-lg border border-sand-200 p-2 text-cocoa-muted transition hover:bg-sand-50 hover:text-cocoa disabled:cursor-not-allowed disabled:opacity-40";

export default function LabelStudio({ filterByOrder, filterByProduct, returnToLabel, onBack }: Props) {
  const {
    profile,
    labelTemplates,
    products,
    handleCreateLabel,
    handleUpdateLabel,
    handleUpdateProfile,
    loading,
  } = useStore();  const doc = useEditorStore((s) => s.doc);
  const zoom = useEditorStore((s) => s.zoom);
  const dirty = useEditorStore((s) => s.dirty);
  const leftTab = useEditorStore((s) => s.leftTab);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const updateField = useEditorStore((s) => s.updateField);
  const setZoomAction = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const setLeftTab = useEditorStore((s) => s.setLeftTab);

  const [confirmBack, setConfirmBack] = useState(false);
  const [menu, setMenu] = useState<"save" | "export" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [missingProduct, setMissingProduct] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Onboarding on first launch ──
  useEffect(() => {
    const onboarded = localStorage.getItem("muyrico.labelstudio.onboarded");
    if (!onboarded && (!profile.name || profile.name === "Muy Rico")) {
      setShowOnboarding(true);
    }
  }, [profile.name]);

  // ── Launch params: load the right template for order/product/custom entry ──
  const launchKey = `${filterByOrder ?? ""}|${filterByProduct ?? ""}`;
  const appliedLaunchRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    if (appliedLaunchRef.current === launchKey) return;
    appliedLaunchRef.current = launchKey;
    let picked: LabelTemplate | undefined;
    let missing = false;
    if (filterByProduct) {
      picked = labelTemplates.find(
        (t) => t.templateKind === "product" && t.productId === filterByProduct
      );
      if (!picked) missing = true;
    }
    if (!picked && filterByOrder) {
      picked =
        labelTemplates.find(
          (t) =>
            t.name.startsWith(`MR-${filterByOrder}`) ||
            t.name.startsWith(`Order #${filterByOrder}`)
        ) ||
        [...labelTemplates]
          .reverse()
          .find((t) => (t.templateKind || "custom") === "custom");
    }
    if (!picked) picked = labelTemplates[0];
    // Load pre-normalized with the real website so QR/disclaimer defaults hold.
    useEditorStore.getState().loadTemplate(normalizeLabel(picked ?? makeFallback(profile.website), profile.website));
    setMissingProduct(missing);
  }, [launchKey, loading, labelTemplates, filterByOrder, filterByProduct, profile.website]);

  // ── Fit-to-view baseScale from stage-area size ────────────────────────────
  const stageAreaRef = useRef<HTMLDivElement>(null);
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageAreaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      setAreaSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { effW, effH } = effectiveDimensions(
    doc.labelWidth,
    doc.labelHeight,
    doc.shape,
    doc.orientation || "portrait"
  );
  const baseScale = useMemo(() => {
    if (areaSize.w <= 0 || areaSize.h <= 0 || effW <= 0 || effH <= 0) return 1;
    const fit = Math.min(
      (areaSize.w * 0.92) / (effW * 96),
      (areaSize.h * 0.92) / (effH * 96)
    );
    return Math.min(3, Math.max(0.2, fit));
  }, [areaSize.w, areaSize.h, effW, effH]);

  // ── Autosave draft: debounced write while dirty; cleared on save success ──
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => {
      try {
        const st = useEditorStore.getState();
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ id: st.doc.id, savedAt: new Date().toISOString(), doc: st.doc })
        );
      } catch {
        /* storage unavailable */
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [dirty, doc]);

  // ── Unsaved guard: browser confirm on reload/close while dirty ───────────
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Keyboard shortcuts with arrow-key coalescing ──────────────────────────
  const arrowMetaRef = useRef<{ id: string | null; at: number }>({ id: null, at: 0 });
  const checkpointTimerRef = useRef<number | null>(null);
  const scheduleCheckpoint = useCallback(() => {
    if (checkpointTimerRef.current !== null) window.clearTimeout(checkpointTimerRef.current);
    checkpointTimerRef.current = window.setTimeout(() => {
      checkpointTimerRef.current = null;
      const st = useEditorStore.getState();
      st.setDoc(st.doc, true); // trailing marker entry so undo lands after the burst
    }, COALESCE_MS);
  }, []);

  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      const el = t instanceof HTMLElement ? t : null;
      if (!el) return false;
      return (
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT" ||
        el.isContentEditable
      );
    }

    function nudge(dx: number, dy: number) {
      const st = useEditorStore.getState();
      const id = st.selection;
      if (!id) return;
      const el = st.doc.elements.find((e) => e.id === id);
      if (!el || el.lock) return;
      const now = Date.now();
      const coalesce = arrowMetaRef.current.id === id && now - arrowMetaRef.current.at < COALESCE_MS;
      arrowMetaRef.current = { id, at: now };
      const nx = Math.min(1, Math.max(0, el.x + dx));
      const ny = Math.min(1, Math.max(0, el.y + dy));
      st.patchElement(id, { x: nx, y: ny }, !coalesce);
      if (coalesce) scheduleCheckpoint();
    }

    function duplicateSelected() {
      const st = useEditorStore.getState();
      const sel = st.selection ? st.doc.elements.find((el) => el.id === st.selection) : null;
      if (!sel) return;
      const copy: LabelElement = {
        ...sel,
        id: newId("el"),
        x: Math.min(1, sel.x + 0.03),
        y: Math.min(1, sel.y + 0.03),
        z: st.doc.elements.reduce((m, e) => Math.max(m, e.z), 0) + 1,
      };
      st.setElements([...st.doc.elements, copy]);
      st.select(copy.id);
    }

    function deleteSelected() {
      const st = useEditorStore.getState();
      const sel = st.selection ? st.doc.elements.find((el) => el.id === st.selection) : null;
      if (!sel || sel.field === "disclaimer" || sel.lock) return;
      st.setElements(st.doc.elements.filter((el) => el.id !== sel.id));
      st.select(null);
    }

    function handleKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        useEditorStore.getState().redo();
        return;
      }
      if (mod && (e.key === "d" || e.key === "D")) {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod || e.altKey) return;
      const step = e.shiftKey ? 0.05 : 0.01;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          nudge(-step, 0);
          break;
        case "ArrowRight":
          e.preventDefault();
          nudge(step, 0);
          break;
        case "ArrowUp":
          e.preventDefault();
          nudge(0, -step);
          break;
        case "ArrowDown":
          e.preventDefault();
          nudge(0, step);
          break;
        case "Delete":
        case "Backspace":
          deleteSelected();
          break;
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      if (checkpointTimerRef.current !== null) {
        window.clearTimeout(checkpointTimerRef.current);
        checkpointTimerRef.current = null;
        const st = useEditorStore.getState();
        st.setDoc(st.doc, true); // flush pending coalesced group on unmount
      }
    };
  }, [scheduleCheckpoint]);

  // ── Save / duplicate ──────────────────────────────────────────────────────
  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const st = useEditorStore.getState();
      const exists = labelTemplates.some((t) => t.id === st.doc.id);
      if (st.doc.id !== "new" && exists) {
        await handleUpdateLabel(st.doc.id, st.doc);
      } else {
        const saved: LabelTemplate = { ...st.doc, id: newId("label") };
        await handleCreateLabel(saved);
        st.setDoc(saved, false);
      }
      useEditorStore.getState().markClean();
      clearDraft();
    } catch (err) {
      console.warn("Save failed:", err);
      setSaveError("Save failed — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const st = useEditorStore.getState();
      const copy: LabelTemplate = {
        ...st.doc,
        id: newId("label"),
        name: "Untitled Label",
        templateKind: "custom",
        productId: null,
      };
      await handleCreateLabel(copy);
      useEditorStore.getState().loadTemplate(normalizeLabel(copy, profile.website));
    } catch (err) {
      console.warn("Duplicate failed:", err);
      setSaveError("Duplicate failed — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function createProductTemplate() {
    const p = products.find((pr) => pr.id === filterByProduct);
    if (!p || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const fresh = makeFallback(profile.website);
      const saved: LabelTemplate = {
        ...fresh,
        productName: p.name,
        details: p.description || "",
        ingredients: p.ingredients || "",
        allergens: p.allergens || "",
        price: `$${p.price.toFixed(2)}`,
        logoEmoji: p.emoji || "🧁",
        id: newId("label"),
        name: `${p.emoji || ""} ${p.name}`.trim(),
        templateKind: "product",
        productId: p.id,
      };
      await handleCreateLabel(saved);
      useEditorStore.getState().loadTemplate(normalizeLabel(saved, profile.website));
      setMissingProduct(false);
    } catch (err) {
      console.warn("Could not create product template:", err);
      setSaveError("Could not create a template for this product.");
    } finally {
      setSaving(false);
    }
  }

  function requestBack() {
    if (dirty) setConfirmBack(true);
    else onBack();
  }

  const railTabs: { id: LeftTab; label: string; icon: typeof Plus }[] = [
    { id: "add", label: "Add", icon: Plus },
    { id: "layers", label: "Layers", icon: Layers },
    { id: "templates", label: "Templates", icon: LayoutTemplate },
  ];

  return (
    <div className="flex h-screen w-full flex-col bg-sand-50 text-cocoa">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="relative z-30 flex h-14 shrink-0 items-center gap-1.5 border-b border-sand-200 bg-white px-2 sm:px-3">
        <button
          type="button"
          onClick={requestBack}
          title={`Back to ${returnToLabel || "Dashboard"}`}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-cocoa-muted transition hover:bg-sand-100 hover:text-cocoa"
        >
          <ArrowLeft size={16} />
          <span className="hidden sm:inline">{returnToLabel || "Dashboard"}</span>
        </button>
        <div className="h-6 w-px shrink-0 bg-sand-200" />
        <input
          value={doc.name}
          onChange={(e) => updateField("name", e.target.value)}
          placeholder="Template name"
          aria-label="Template name"
          className="w-28 min-w-0 rounded-md bg-transparent px-1 py-1 text-sm font-semibold outline-none transition hover:bg-sand-50 focus:bg-sand-50 sm:w-44"
        />

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => useEditorStore.getState().undo()}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className={TOOL_BTN}
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            onClick={() => useEditorStore.getState().redo()}
            disabled={!canRedo}
            title="Redo (⌘⇧Z)"
            className={TOOL_BTN}
          >
            <Redo2 size={15} />
          </button>

          <div className="mx-0.5 hidden h-6 w-px bg-sand-200 sm:block" />
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() => setZoomAction(zoom - ZOOM_STEP)}
              disabled={zoom <= 25}
              title="Zoom out"
              className={TOOL_BTN}
            >
              <ZoomOut size={15} />
            </button>
            <span className="w-10 text-center text-xs tabular-nums text-cocoa-muted">{zoom}%</span>
            <button
              type="button"
              onClick={() => setZoomAction(zoom + ZOOM_STEP)}
              disabled={zoom >= 400}
              title="Zoom in"
              className={TOOL_BTN}
            >
              <ZoomIn size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                setZoomAction(100);
                setPan(0, 0);
              }}
              title="Fit to view"
              className={`${TOOL_BTN} w-auto gap-1 px-2`}
            >
              <Maximize size={13} />
              Fit
            </button>
          </div>

          <div className="mx-0.5 hidden h-6 w-px bg-sand-200 md:block" />
          <button
            type="button"
            onClick={() => useEditorStore.getState().toggleCompliance()}
            title="Compliance checklist"
            className="hidden rounded-full transition hover:opacity-80 md:block"
          >
            <ComplianceScore label={doc} profile={profile} />
          </button>

          {saveError && (
            <span className="max-w-[180px] truncate text-xs font-medium text-hibiscus" title={saveError}>
              {saveError}
            </span>
          )}

          {/* Save menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === "save" ? null : "save")}
              disabled={saving}
              className="flex items-center gap-1 rounded-lg bg-palm px-3 py-1.5 text-xs font-semibold text-white transition hover:shadow-md disabled:opacity-60"
            >
              <Save size={14} />
              <span className="hidden sm:inline">{saving ? "Saving…" : "Save"}</span>
              <ChevronDown size={12} />
            </button>
            {menu === "save" && (
              <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-sand-200 bg-white py-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    handleSave();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-cocoa transition hover:bg-sand-50"
                >
                  <Save size={14} className="text-cocoa-muted" /> Save
                  {dirty && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-coral" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenu(null);
                    handleDuplicate();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-cocoa transition hover:bg-sand-50"
                >
                  <Copy size={14} className="text-cocoa-muted" /> Duplicate as new
                </button>
              </div>
            )}
          </div>

          {/* Export popover — items stubbed until Task 11 */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu(menu === "export" ? null : "export")}
              title="Export"
              className={`${TOOL_BTN} gap-1.5 px-2`}
            >
              <Download size={14} />
              <span className="hidden lg:inline">Export</span>
            </button>
            {menu === "export" && (
              <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-sand-200 bg-white py-1 shadow-xl">
                {(
                  [
                    { icon: ImageIcon, label: "PNG" },
                    { icon: FileImage, label: "JPG" },
                    { icon: FileText, label: "PDF exact" },
                    { icon: FileCode, label: "PDF vector" },
                    { icon: Printer, label: "Print" },
                    { icon: ExternalLink, label: "Open & Print" },
                    { icon: Share2, label: "Share" },
                  ] as const
                ).map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    type="button"
                    disabled
                    title="Wired in Task 11"
                    className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-2 text-left text-sm text-cocoa-muted opacity-60"
                  >
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Menu backdrop */}
        {menu && <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />}
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Left rail — lg+ only this task (<lg drawers land in Task 8) */}
        <aside className="hidden w-[280px] shrink-0 flex-col border-r border-sand-200 bg-white lg:flex">
          <div className="flex shrink-0 border-b border-sand-200">
            {railTabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setLeftTab(id)}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition ${
                  leftTab === id
                    ? "border-b-2 border-palm bg-palm-50 text-palm"
                    : "border-b-2 border-transparent text-cocoa-muted hover:bg-sand-50"
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {leftTab === "add" && <AddTab />}
            {leftTab === "layers" && <LayersTab />}
            {leftTab === "templates" && (
              <TemplatesTab filterByOrder={filterByOrder} filterByProduct={filterByProduct} />
            )}
          </div>
        </aside>

        {/* Stage */}
        <main
          ref={stageAreaRef}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-sand-100"
        >
          {missingProduct && (
            <div className="absolute left-1/2 top-3 z-10 flex max-w-[92%] -translate-x-1/2 items-center gap-2 rounded-xl border border-hibiscus/30 bg-hibiscus-light/10 px-3 py-2 text-xs text-hibiscus">
              <AlertTriangle size={14} className="shrink-0" />
              <span>No template exists for this product yet.</span>
              <button
                type="button"
                onClick={createProductTemplate}
                disabled={saving}
                className="shrink-0 font-semibold underline disabled:opacity-60"
              >
                Create one
              </button>
            </div>
          )}
          <StageCanvas baseScale={baseScale} profile={profile} />
        </main>

        {/* Inspector column — placeholder this task */}
        <aside className="hidden w-[300px] shrink-0 flex-col border-l border-sand-200 bg-white lg:flex">
          <div className="flex h-14 shrink-0 items-center border-b border-sand-200 px-4">
            <h3 className="font-serif text-base font-semibold text-cocoa">Inspector</h3>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <p className="text-center text-xs text-cocoa-muted">Inspector lands in Task 9</p>
          </div>
        </aside>
      </div>

      {/* ── <lg: bottom bar opening the active rail as a bottom-sheet drawer ── */}
      <nav className="flex shrink-0 border-t border-sand-200 bg-white lg:hidden">
        {railTabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setLeftTab(id);
              setDrawerOpen((v) => (leftTab === id ? !v : true));
            }}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 text-[10px] font-medium transition ${
              leftTab === id && drawerOpen
                ? "border-palm bg-palm-50 text-palm"
                : "border-transparent text-cocoa-muted hover:bg-sand-50"
            }`}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-cocoa/40"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-sand-200 bg-white shadow-2xl">
            <div className="flex justify-center pt-2">
              <div className="h-1 w-10 rounded-full bg-sand-200" />
            </div>
            <div className="flex shrink-0 border-b border-sand-200">
              {railTabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setLeftTab(id)}
                  className={`flex min-h-12 flex-1 items-center justify-center gap-1.5 border-b-2 text-xs font-medium transition ${
                    leftTab === id
                      ? "border-palm bg-palm-50 text-palm"
                      : "border-transparent text-cocoa-muted hover:bg-sand-50"
                  }`}
                >
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {leftTab === "add" && <AddTab />}
              {leftTab === "layers" && <LayersTab />}
              {leftTab === "templates" && (
                <TemplatesTab
                  filterByOrder={filterByOrder}
                  filterByProduct={filterByProduct}
                  onTemplateOpen={() => setDrawerOpen(false)}
                />
              )}
            </div>
          </div>
        </div>
      )}

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

      <CompliancePanel />

      <Modal open={confirmBack} onClose={() => setConfirmBack(false)} title="Discard unsaved changes?">
        <p className="text-sm text-cocoa-muted">
          Your latest edits haven&apos;t been saved to this label.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmBack(false)}
            className="rounded-xl border border-sand-200 bg-white px-4 py-2 text-sm font-medium text-cocoa transition hover:bg-sand-50"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmBack(false);
              onBack();
            }}
            className="rounded-xl bg-coral px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Discard
          </button>
        </div>
      </Modal>
    </div>
  );
}
