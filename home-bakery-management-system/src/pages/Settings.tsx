import { useState } from "react";
import { CheckCircle2, RefreshCcw, Save } from "lucide-react";
import { useStore } from "../context/StoreContext";
import type { PaymentMethod } from "../types";
import { PAYMENT_METHOD_LABELS } from "../utils/format";

const METHOD_ICONS: Record<PaymentMethod, string> = {
  stripe: "💳",
  cashapp: "💵",
  venmo: "📲",
  applepay: "🍎",
  cash: "💰",
};

export default function Settings() {
  const { profile, setProfile, resetAllData } = useStore();
  const [draft, setDraft] = useState(profile);
  const [saved, setSaved] = useState(false);

  function save() {
    setProfile(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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
            </div>
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
            All information is stored locally in this browser. Resetting will restore the original demo data.
          </p>
          <button
            onClick={() => {
              if (confirm("Reset all data to the original demo content? This cannot be undone.")) resetAllData();
            }}
            className="rounded-xl border border-hibiscus bg-white px-4 py-2 text-xs font-medium text-hibiscus hover:bg-hibiscus-light/10"
          >
            Reset to demo data
          </button>
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
