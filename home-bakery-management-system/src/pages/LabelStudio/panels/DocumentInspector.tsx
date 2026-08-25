import type { BusinessProfile } from "../../../types";
import IngredientSorter from "../../../components/label/IngredientSorter";
import NetWeightInput from "../../../components/label/NetWeightInput";
import { defaultNfpElement } from "../../../components/label/defaultElements";
import { newId } from "../../../utils/format";
import { useEditorStore } from "../state";

interface Props {
  profile: BusinessProfile;
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

/** Document-level fields shown when nothing is selected. */
export default function DocumentInspector({ profile }: Props) {
  const doc = useEditorStore((s) => s.doc);
  const updateField = useEditorStore((s) => s.updateField);
  const setDoc = useEditorStore((s) => s.setDoc);

  const isRegistered = doc.businessIdMode === "registration";
  const hasNfp = doc.elements.some((e) => e.type === "nfp");

  function addNfp() {
    const st = useEditorStore.getState();
    const maxZ = st.doc.elements.reduce((m, e) => Math.max(m, e.z), 0);
    const el = { ...defaultNfpElement(), id: newId("el"), z: maxZ + 1 };
    st.setElements([...st.doc.elements, el]);
    st.select(el.id);
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto p-3">
      <Section title="Label text">
        <div className="space-y-2">
          <input
            data-fix-target="businessName"
            value={doc.businessName || profile.name}
            onChange={(e) => updateField("businessName", e.target.value)}
            placeholder="Business name"
            className="input"
          />
          <input
            data-fix-target="productName"
            value={doc.productName}
            onChange={(e) => updateField("productName", e.target.value)}
            placeholder="Product name"
            className="input"
          />
          <textarea
            data-fix-target="details"
            value={doc.details}
            onChange={(e) => updateField("details", e.target.value)}
            placeholder="Short description"
            rows={2}
            className="input"
          />
          <div data-fix-target="ingredients">
            <IngredientSorter
              value={doc.ingredients}
              onChange={(v) => updateField("ingredients", v)}
            />
          </div>
          <div data-fix-target="netWeightUS">
            <NetWeightInput
              netWeightUS={doc.netWeightUS}
              netWeightMetric={doc.netWeightMetric}
              onChange={(us, metric) =>
                setDoc({ ...doc, netWeightUS: us, netWeightMetric: metric })
              }
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              value={doc.price}
              onChange={(e) => updateField("price", e.target.value)}
              placeholder="Price"
              className="input"
            />
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-cocoa-muted">
              <input
                type="checkbox"
                checked={doc.showPrice}
                onChange={(e) => updateField("showPrice", e.target.checked)}
              />
              Show
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={doc.bestByDays}
              onChange={(e) => {
                const n = Number(e.target.value);
                updateField("bestByDays", Number.isFinite(n) ? n : 7);
              }}
              placeholder="Best by (days)"
              className="input"
            />
            <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-cocoa-muted">
              <input
                type="checkbox"
                checked={doc.showBestBy}
                onChange={(e) => updateField("showBestBy", e.target.checked)}
              />
              Show
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-cocoa-muted">
            <input
              type="checkbox"
              checked={doc.nutrientClaim}
              onChange={(e) => updateField("nutrientClaim", e.target.checked)}
            />
            This product uses a nutrient content claim (e.g., &ldquo;low fat&rdquo;,
            &ldquo;sugar free&rdquo;)
          </label>
          {doc.nutrientClaim && (
            <p className="text-[10px] text-hibiscus">
              Using health/nutrient claims removes your exemption from full nutrition labeling
              (21 CFR &sect;101.2).
            </p>
          )}
        </div>
      </Section>

      <Section title="Business identification">
        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => updateField("businessIdMode", "registration")}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium leading-tight ${
                isRegistered
                  ? "border-palm bg-palm text-white"
                  : "border-sand-200 text-cocoa-muted"
              }`}
            >
              Name + Phone + Reg #
            </button>
            <button
              type="button"
              onClick={() => updateField("businessIdMode", "address")}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium leading-tight ${
                !isRegistered
                  ? "border-palm bg-palm text-white"
                  : "border-sand-200 text-cocoa-muted"
              }`}
            >
              Name + Address
            </button>
          </div>
          {isRegistered ? (
            <>
              <input
                data-fix-target="phoneNumber"
                value={doc.phoneNumber || profile.phone}
                onChange={(e) => updateField("phoneNumber", e.target.value)}
                placeholder="Phone"
                className="input"
              />
              <input
                data-fix-target="registrationNumber"
                value={doc.registrationNumber || profile.registrationNumber}
                onChange={(e) => updateField("registrationNumber", e.target.value)}
                placeholder="Registration # (from MSU Product Center)"
                className="input"
              />
            </>
          ) : (
            <textarea
              data-fix-target="address"
              value={doc.address || profile.address}
              onChange={(e) => updateField("address", e.target.value)}
              placeholder={`Address (default: ${profile.address})`}
              rows={2}
              className="input"
            />
          )}
          <label className="flex items-center gap-2 text-xs text-cocoa-muted">
            <input
              type="checkbox"
              checked={isRegistered}
              onChange={(e) =>
                updateField("businessIdMode", e.target.checked ? "registration" : "address")
              }
            />
            Use MSU Registration Number (hides home address &mdash; MCL 289.4102(8)(9))
          </label>
        </div>
      </Section>

      <Section title="Nutrition Facts">
        <p className="mb-2 text-[11px] text-cocoa-muted">
          {hasNfp
            ? "A Nutrition Facts panel is on this label."
            : "No Nutrition Facts panel on this label."}
        </p>
        <button
          type="button"
          data-fix-target="nfp"
          onClick={addNfp}
          className="w-full rounded-lg border border-dashed border-sand-300 py-2 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
        >
          + Add Nutrition Facts panel
        </button>
      </Section>

      <p className="px-1 text-[10px] text-cocoa-muted">
        Links and QR code point to {doc.websiteUrl || profile.website || "https://muy-rico.com"}
      </p>
    </div>
  );
}
