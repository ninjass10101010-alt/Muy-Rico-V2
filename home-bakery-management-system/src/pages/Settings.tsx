import { useState } from "react";
import { CheckCircle2, RefreshCcw, Save } from "lucide-react";
import { useStore } from "../context/StoreContext";
import type { BusinessProfile, PaymentMethod } from "../types";
import { PAYMENT_METHOD_LABELS } from "../utils/format";
import { backfillAllOrderLabels } from "../utils/api";

const METHOD_ICONS: Record<PaymentMethod, string> = {
  stripe: "💳",
  cashapp: "💵",
  venmo: "📲",
  applepay: "🍎",
  cash: "💰",
};

export default function Settings() {
  const { profile, handleUpdateProfile, resetAllData } = useStore();
  const [draft, setDraft] = useState<BusinessProfile>(profile);
  const [saved, setSaved] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);

  async function save() {
    try {
      await handleUpdateProfile(draft);
    } catch (err) {
      console.error("Failed to save profile:", err);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await backfillAllOrderLabels();
      setBackfillResult(`Success! Processed ${res.ordersProcessed} orders and generated ${res.labelsGenerated} new labels.`);
    } catch (err) {
      setBackfillResult("Error backfilling labels. Please try again.");
    } finally {
      setBackfilling(false);
    }
  }

  function toggleMethod(m: PaymentMethod) {
    setDraft((d) => ({ ...d, acceptedMethods: { ...d.acceptedMethods, [m]: !d.acceptedMethods[m] } }));
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-serif text-sm font-semibold text-cocoa">Business profile</h3>
          <div className="space-y-3">
            <Field label="Business name">
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input" />
            </Field>
            <Field label="Tagline">
              <input value={draft.tagline} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} className="input" />
            </Field>
            <Field label="Address">
              <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} className="input" />
            </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone">
                  <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className="input" />
                </Field>
                <Field label="Email">
                  <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className="input" />
                </Field>
                <Field label="Business type">
                  <select
                    value={draft.businessType}
                    onChange={(e) => setDraft({ ...draft, businessType: e.target.value as "cottage" | "licensed" | "maple-honey"})}
                    className="input"
                  >
                    <option value="cottage">Cottage Food Producer</option>
                    <option value="licensed">Licensed Food Processor</option>
                    <option value="maple-honey">Maple Syrup & Honey Producer</option>
                  </select>
                </Field>
              </div>
            <Field label="Website (QR default)">
              <input
                value={draft.website || ""}
                onChange={(e) => setDraft({ ...draft, website: e.target.value })}
                className="input"
                placeholder="https://muy-rico.com"
              />
              <p className="mt-1 text-[10px] text-cocoa-muted leading-relaxed">
                Used as the default URL encoded in label QR codes. Override per label in the Label Designer.
              </p>
            </Field>
            <Field label="MSU Product Center registration number">
              <input value={draft.registrationNumber} onChange={(e) => setDraft({ ...draft, registrationNumber: e.target.value })} className="input" placeholder="e.g. C-000000000" />
              <p className="mt-1 text-[10px] text-cocoa-muted leading-relaxed">
                Registered with MSU Product Center? Your registration number replaces your home address on labels.
                Leave blank to use name + address instead.
              </p>
            </Field>
          </div>
        </div>

        <div className="rounded-[40px_12px_40px_12px] border border-hibiscus-light/30 bg-hibiscus-light/10 p-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-hibiscus">
            <RefreshCcw size={15} /> Data management
          </h3>
          <p className="mb-3 text-xs text-hibiscus">
            All information is stored on the server and shared across your devices. Resetting will restore the original demo data.
          </p>
          <button
            onClick={async () => {
              if (confirm("Reset all data to the original demo content? This cannot be undone.")) await resetAllData();
            }}
            className="rounded-xl border border-hibiscus bg-white px-4 py-2 text-xs font-medium text-hibiscus hover:bg-hibiscus-light/10"
          >
            Reset to demo data
          </button>
        </div>

        <div className="rounded-[40px_12px_40px_12px] border border-palm/30 bg-palm/5 p-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-palm">
            <RefreshCcw size={15} /> Label backfill
          </h3>
          <p className="mb-3 text-xs text-palm/80">
            Generate compliant ingredient labels for any past orders that do not already have them.
          </p>
          <button
            disabled={backfilling}
            onClick={handleBackfill}
            className="rounded-xl border border-palm bg-white px-4 py-2 text-xs font-medium text-palm hover:bg-palm/10 disabled:opacity-50"
          >
            {backfilling ? "Backfilling..." : "Backfill past labels"}
          </button>
          {backfillResult && (
            <p className="mt-2 text-xs text-palm font-medium leading-relaxed">{backfillResult}</p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-[40px_12px_40px_12px] border border-sand-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-serif text-sm font-semibold text-cocoa">Accepted payment methods</h3>
          <div className="space-y-3">
            {(Object.keys(draft.acceptedMethods) as PaymentMethod[]).map((m) => (
              <label
                key={m}
                className="flex items-center justify-between rounded-xl border border-sand-100 bg-sand-50 px-4 py-3"
              >
                <span className="flex items-center gap-2 text-sm text-cocoa">
                  {METHOD_ICONS[m]} {PAYMENT_METHOD_LABELS[m]}
                </span>
                <input
                  type="checkbox"
                  checked={draft.acceptedMethods[m]}
                  onChange={() => toggleMethod(m)}
                  className="h-4 w-4"
                />
              </label>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <Field label="Cash App $cashtag">
              <input value={draft.cashtag} onChange={(e) => setDraft({ ...draft, cashtag: e.target.value })} className="input" />
            </Field>
            <Field label="Venmo handle">
              <input value={draft.venmoHandle} onChange={(e) => setDraft({ ...draft, venmoHandle: e.target.value })} className="input" />
            </Field>
            <label className="flex items-center justify-between rounded-xl border border-sand-100 bg-sand-50 px-4 py-3 text-sm text-cocoa">
              Stripe account connected
              <input
                type="checkbox"
                checked={draft.stripeConnected}
                onChange={(e) => setDraft({ ...draft, stripeConnected: e.target.checked })}
                className="h-4 w-4"
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-sand-100 bg-sand-50 px-4 py-3 text-sm text-cocoa">
              Apple Pay enabled on checkout
              <input
                type="checkbox"
                checked={draft.applePayEnabled}
                onChange={(e) => setDraft({ ...draft, applePayEnabled: e.target.checked })}
                className="h-4 w-4"
              />
            </label>
          </div>
        </div>

        <button
          onClick={save}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-mid-green to-palm py-3 text-sm font-semibold text-white transition hover:shadow-md"
        >
          {saved ? (
            <>
              <CheckCircle2 size={16} /> Saved!
            </>
          ) : (
            <>
              <Save size={16} /> Save Settings
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-cocoa-muted">{label}</label>
      {children}
    </div>
  );
}
