import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { BusinessProfile } from "../../../types";
import Modal from "../../../components/ui/Modal";
import ComplianceChecklist from "../../../components/label/ComplianceChecklist";
import FontCompliancePanel from "../../../components/label/FontCompliancePanel";
import AllergenPicker from "../../../components/label/AllergenPicker";
import ProductTypeSelector from "../../../components/label/ProductTypeSelector";
import MILawReference from "../../../components/label/MILawReference";
import { effectiveDimensions } from "../../../components/label/defaultElements";
import { normalizeLabel } from "../templateUtils";
import { useEditorStore } from "../state";

interface Props {
  profile: BusinessProfile;
  /** Opens the Inspector bottom drawer (<lg). Desktop already shows the inspector column. */
  onOpenInspector?: () => void;
}

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

/** Scroll to + focus the nearest visible element carrying data-fix-target. */
function focusFixTarget(target: string) {
  const matches = Array.from(
    document.querySelectorAll<HTMLElement>(`[data-fix-target="${target}"]`)
  );
  // Skip display:none copies (e.g. the hidden right column on <lg).
  const el = matches.find((n) => n.getClientRects().length > 0) || matches[0];
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof el.focus === "function") {
    window.setTimeout(() => el.focus(), 250);
  }
}

/** Right slide-over drawer with the full compliance workflow. */
export default function CompliancePanel({ profile, onOpenInspector }: Props) {
  const open = useEditorStore((s) => s.complianceOpen);
  const toggleCompliance = useEditorStore((s) => s.toggleCompliance);
  const doc = useEditorStore((s) => s.doc);
  const updateField = useEditorStore((s) => s.updateField);
  const patchElement = useEditorStore((s) => s.patchElement);
  const select = useEditorStore((s) => s.select);

  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);

  const normalized = normalizeLabel(doc, profile.website);
  const { effW } = effectiveDimensions(
    doc.labelWidth,
    doc.labelHeight,
    doc.shape,
    doc.orientation || "portrait"
  );

  function closePanel() {
    const st = useEditorStore.getState();
    if (st.complianceOpen) st.toggleCompliance();
  }

  /**
   * Field fixes: keep the panel open on desktop (target scrolls behind it,
   * focused for when the panel closes). On <lg the DocumentInspector lives in
   * the drawer, so close the panel, open the inspector drawer, then focus.
   * `allergens` lives inside this panel, so it always stays put.
   */
  function focusField(target: string, inPanel: boolean) {
    if (!inPanel && window.matchMedia("(max-width: 1023px)").matches) {
      closePanel();
      onOpenInspector?.();
      window.setTimeout(() => focusFixTarget(target), 400);
      return;
    }
    focusFixTarget(target);
  }

  // ── Fix-it wiring (ports legacy LabelDesigner onComplianceFix) ───────────
  function onComplianceFix(issueId: string, fieldName: string, elementId?: string) {
    if (issueId === "disclaimer-hidden" || fieldName === "showDisclaimer") {
      updateField("showDisclaimer", true);
      return;
    }
    if (issueId === "disclaimer-font" || issueId === "disclaimer-contrast") {
      if (elementId) select(elementId);
      else {
        const disc = doc.elements.find((e) => e.field === "disclaimer");
        if (disc) select(disc.id);
      }
      closePanel();
      return;
    }
    if (issueId === "nfp-missing") {
      focusField("nfp", false);
      return;
    }
    if (issueId === "biz-name" || fieldName === "businessName") {
      focusField("businessName", false);
      return;
    }
    if (issueId === "product-name" || fieldName === "productName") {
      focusField("productName", false);
      return;
    }
    if (issueId === "ingredients" || fieldName === "ingredients") {
      focusField("ingredients", false);
      return;
    }
    if (issueId === "allergens" || fieldName === "allergens") {
      focusField("allergens", true);
      return;
    }
    if (issueId === "net-weight" || fieldName === "netWeightUS") {
      focusField("netWeightUS", false);
      return;
    }
    if (issueId === "biz-address" || issueId === "biz-pobox" || fieldName === "address") {
      focusField("address", false);
      return;
    }
    if (issueId === "biz-phone" || fieldName === "phoneNumber") {
      focusField("phoneNumber", false);
      return;
    }
    if (issueId === "biz-reg" || fieldName === "registrationNumber") {
      focusField("registrationNumber", false);
      return;
    }
    if (elementId) {
      select(elementId);
      closePanel();
    }
  }

  function handleToggleDisclaimer() {
    if (doc.showDisclaimer) setShowDisclaimerModal(true);
    else updateField("showDisclaimer", true);
  }

  function confirmHideDisclaimer() {
    updateField("showDisclaimer", false);
    setShowDisclaimerModal(false);
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-palm/40 backdrop-blur-sm lg:hidden"
          onClick={toggleCompliance}
        />
      )}
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-[360px] max-w-[92vw] flex-col border-l border-sand-200 bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-sand-200 px-4">
          <h3 className="font-serif text-base font-semibold text-cocoa">Compliance</h3>
          <button
            type="button"
            onClick={toggleCompliance}
            aria-label="Close compliance panel"
            className="rounded-full p-1.5 text-cocoa-muted transition hover:bg-sand-100 hover:text-cocoa"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          <Section title="Checklist">
            <ComplianceChecklist
              label={normalized}
              profile={profile}
              onFix={onComplianceFix}
              onSelectElement={select}
            />
          </Section>

          <Section title="Allergens">
            <div data-fix-target="allergens">
              <AllergenPicker
                value={doc.allergenTags}
                noAllergensConfirmed={doc.noAllergensConfirmed}
                onChange={(tags) => updateField("allergenTags", tags)}
                onNoAllergens={(v) => updateField("noAllergensConfirmed", v)}
                ingredientsText={doc.ingredients}
              />
            </div>
          </Section>

          <Section title="MDARD disclaimer">
            <label className="flex items-center gap-2 text-xs text-cocoa">
              <input
                type="checkbox"
                checked={doc.showDisclaimer}
                onChange={handleToggleDisclaimer}
              />
              <span>Show required disclaimer</span>
            </label>
            {!doc.showDisclaimer && (
              <p className="mt-1 text-[10px] font-medium text-hibiscus">
                Michigan Cottage Food Law requires this statement on every label.
              </p>
            )}
          </Section>

          <Section title="Product type">
            <ProductTypeSelector
              value={doc.productType}
              onChange={(v) => updateField("productType", v)}
            />
            {doc.nutrientClaim && (
              <p className="mt-2 flex items-start gap-1.5 text-[10px] text-hibiscus">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                Nutrient claim in use &mdash; a Nutrition Facts panel is required.
              </p>
            )}
          </Section>

          <Section title="Font size">
            <FontCompliancePanel
              label={normalized}
              effW={effW}
              onFix={(id, cqw) => patchElement(id, { fontSizeOverride: cqw })}
            />
          </Section>

          <MILawReference />
        </div>
      </aside>

      {/* Disclaimer warning modal — ported from legacy LabelDesigner */}
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
              <p className="mt-1 text-xs leading-relaxed text-cocoa-muted">
                Per MCL 289.4102(3)(g), every cottage food label must include the following
                statement printed in at least 11-point font with clear contrast to the background:
              </p>
              <p className="mt-2 rounded-lg bg-sand-100 p-2.5 text-[11px] italic text-cocoa-muted">
                &ldquo;Made in a home kitchen that has not been inspected by the Michigan
                Department of Agriculture and Rural Development.&rdquo;
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowDisclaimerModal(false)}
              className="rounded-lg border border-sand-200 px-4 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
            >
              Keep disclaimer
            </button>
            <button
              type="button"
              onClick={confirmHideDisclaimer}
              className="rounded-lg bg-hibiscus px-4 py-2 text-xs font-medium text-white hover:bg-hibiscus-light"
            >
              Hide anyway
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
