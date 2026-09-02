import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, RefreshCcw, Save, Bell, CreditCard, AlertCircle } from "lucide-react";
import { useStore } from "../context/StoreContext";
import type { BusinessProfile, PaymentMethod } from "../types";
import { DEFAULT_REMINDER_CONFIG } from "../types";
import { saveReminderConfigToLocal } from "../utils/reminders";
import { PAYMENT_METHOD_LABELS } from "../utils/format";
import { backfillAllOrderLabels } from "../utils/api";

const METHOD_ICONS: Record<PaymentMethod, string> = {
  stripe: "💳",
  paypal: "🅿️",
  cashapp: "💵",
  venmo: "📲",
  applepay: "🍎",
  cash: "💰",
};

const CHECKOUT_WORKER = "https://muy-rico-checkout.bexgarcia0208.workers.dev";

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  if (raw.trim() === "") return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export default function Settings() {
  const { profile, handleUpdateProfile, resetAllData } = useStore();
  const [draft, setDraft] = useState<BusinessProfile>(profile);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState<string | null>(null);
  const [stripeStatus, setStripeStatus] = useState<"loading" | "connected" | "not_configured" | "error">("loading");
  const [resetting, setResetting] = useState(false);
  const savedTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setDraft(profile);
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${CHECKOUT_WORKER}/stripe-config`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { publishableKey?: string }) => {
        if (cancelled) return;
        setStripeStatus(data?.publishableKey ? "connected" : "not_configured");
      })
      .catch(() => {
        if (!cancelled) setStripeStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (savedTimeoutRef.current) window.clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      saveReminderConfigToLocal(draft.reminders ?? DEFAULT_REMINDER_CONFIG);
      await handleUpdateProfile(draft);
      setSaved(true);
      if (savedTimeoutRef.current) window.clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save. Please try again.";
      setSaveError(msg);
      console.error("Failed to save profile:", err);
    } finally {
      setSaving(false);
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    setBackfillResult(null);
    try {
      const res = await backfillAllOrderLabels();
      setBackfillResult(`Success! Processed ${res.ordersProcessed} orders and generated ${res.labelsGenerated} new labels.`);
    } catch {
      setBackfillResult("Error backfilling labels. Please try again.");
    } finally {
      setBackfilling(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset business settings to defaults? Orders, products and customers are not affected.")) return;
    setResetting(true);
    try {
      await resetAllData();
    } finally {
      setResetting(false);
    }
  }

  function toggleMethod(m: PaymentMethod) {
    setDraft((d) => ({ ...d, acceptedMethods: { ...d.acceptedMethods, [m]: !d.acceptedMethods[m] } }));
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm">
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
            <Field label="Business type">
              <select
                value={draft.businessType === "cottage" || draft.businessType === "licensed" ? draft.businessType : "cottage"}
                onChange={(e) => setDraft({ ...draft, businessType: e.target.value as "cottage" | "licensed" })}
                className="input"
              >
                <option value="cottage">Cottage Food Producer</option>
                <option value="licensed">Licensed Food Processor</option>
              </select>
            </Field>
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

        <div className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 font-serif text-sm font-semibold text-cocoa">
            <Bell size={15} className="text-coral" /> Reminders
          </h3>
          <p className="mb-4 text-xs text-cocoa-muted">When should the dashboard alert you before an order is due? Saved to this browser and synced to the server.</p>
          <div className="space-y-3">
            <Field label="Remind N days before due">
              <input
                type="number"
                min={1}
                max={14}
                value={draft.reminders?.leadDays ?? DEFAULT_REMINDER_CONFIG.leadDays}
                onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), leadDays: clampInt(e.target.value, 1, 14, DEFAULT_REMINDER_CONFIG.leadDays) } })}
                className="input"
              />
            </Field>
            <label className="flex items-center justify-between rounded-lg border border-sand-200 px-3 py-2.5">
              <span className="text-sm text-cocoa">Also remind on the due day</span>
              <input
                type="checkbox"
                checked={draft.reminders?.dayOf ?? DEFAULT_REMINDER_CONFIG.dayOf}
                onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), dayOf: e.target.checked } })}
                className="h-4 w-4 accent-palm"
              />
            </label>
            <Field label="Default snooze (hours)">
              <input
                type="number"
                min={1}
                value={draft.reminders?.defaultSnoozeHours ?? DEFAULT_REMINDER_CONFIG.defaultSnoozeHours}
                onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), defaultSnoozeHours: clampInt(e.target.value, 1, 168, DEFAULT_REMINDER_CONFIG.defaultSnoozeHours) } })}
                className="input"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day view starts at (24h)">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={draft.reminders?.dayStartTime ?? DEFAULT_REMINDER_CONFIG.dayStartTime}
                  onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), dayStartTime: clampInt(e.target.value, 0, 23, DEFAULT_REMINDER_CONFIG.dayStartTime) } })}
                  className="input"
                />
              </Field>
              <Field label="Day view ends at (24h)">
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={draft.reminders?.dayEndTime ?? DEFAULT_REMINDER_CONFIG.dayEndTime}
                  onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), dayEndTime: clampInt(e.target.value, 1, 24, DEFAULT_REMINDER_CONFIG.dayEndTime) } })}
                  className="input"
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-hibiscus-light/30 bg-hibiscus-light/10 p-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-hibiscus">
            <RefreshCcw size={15} /> Reset settings
          </h3>
          <p className="mb-3 text-xs text-hibiscus">Restores business profile fields, payment handles and accepted-method toggles to demo defaults. Orders, products and customer data are not affected.</p>
          <button
            disabled={resetting}
            onClick={handleReset}
            className="rounded-xl border border-hibiscus bg-white px-4 py-2 text-xs font-medium text-hibiscus hover:bg-hibiscus-light/10 disabled:opacity-50"
          >
            {resetting ? "Resetting…" : "Reset settings to defaults"}
          </button>
        </div>

        <div className="rounded-xl border border-palm/30 bg-palm/5 p-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-palm">
            <RefreshCcw size={15} /> Label backfill
          </h3>
          <p className="mb-3 text-xs text-palm/80">Generate compliant ingredient labels for any past orders that do not already have them.</p>
          <button
            disabled={backfilling}
            onClick={handleBackfill}
            className="rounded-xl border border-palm bg-white px-4 py-2 text-xs font-medium text-palm hover:bg-palm/10 disabled:opacity-50"
          >
            {backfilling ? "Backfilling..." : "Backfill past labels"}
          </button>
          {backfillResult && <p className="mt-2 text-xs text-palm font-medium leading-relaxed">{backfillResult}</p>}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-serif text-sm font-semibold text-cocoa">Accepted payment methods</h3>
          <p className="mb-3 text-xs text-cocoa-muted">Controls which methods customers can use and which appear as accepted badges. Card payments require Stripe to be connected (see below).</p>
          <div className="space-y-3">
            {(Object.keys(draft.acceptedMethods) as PaymentMethod[]).map((m) => (
              <label key={m} className="flex items-center justify-between rounded-xl border border-sand-100 bg-sand-50 px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-cocoa">
                  {METHOD_ICONS[m]} {PAYMENT_METHOD_LABELS[m]}
                </span>
                <input type="checkbox" checked={draft.acceptedMethods[m]} onChange={() => toggleMethod(m)} className="h-4 w-4" />
              </label>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <Field label="Cash App $cashtag">
              <input value={draft.cashtag} onChange={(e) => setDraft({ ...draft, cashtag: e.target.value })} className="input" placeholder="$MuyRicoBakery" />
              <p className="mt-1 text-[10px] text-cocoa-muted">Shown to customers on the CashApp / Venmo payment tab.</p>
            </Field>
            <Field label="Venmo handle">
              <input value={draft.venmoHandle} onChange={(e) => setDraft({ ...draft, venmoHandle: e.target.value })} className="input" placeholder="@Muy-Rico" />
            </Field>
          </div>
        </div>

        <div className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 flex items-center gap-2 font-serif text-sm font-semibold text-cocoa">
            <CreditCard size={15} className="text-coral" /> Card payments
          </h3>
          <div className="rounded-lg border border-sand-200 bg-sand-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-cocoa">Stripe</span>
              {stripeStatus === "loading" && <span className="text-xs text-cocoa-muted">Checking…</span>}
              {stripeStatus === "connected" && <span className="inline-flex items-center gap-1 text-xs font-semibold text-palm"><CheckCircle2 size={12} /> Connected</span>}
              {stripeStatus === "not_configured" && <span className="inline-flex items-center gap-1 text-xs font-semibold text-hibiscus"><AlertCircle size={12} /> Not configured</span>}
              {stripeStatus === "error" && <span className="text-xs text-cocoa-muted">Unable to check</span>}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-cocoa-muted">
              Card payments are powered by Stripe. Apple Pay is included automatically when Stripe is connected and the domain is verified in Stripe. Manage keys in the Worker env; this page shows live connection status from the checkout worker.
            </p>
            <button
              onClick={() => {
                setStripeStatus("loading");
                fetch(`${CHECKOUT_WORKER}/stripe-config`)
                  .then((r) => (r.ok ? r.json() : Promise.reject()))
                  .then((d: { publishableKey?: string }) => setStripeStatus(d?.publishableKey ? "connected" : "not_configured"))
                  .catch(() => setStripeStatus("error"));
              }}
              className="mt-3 rounded-lg border border-sand-200 bg-white px-3 py-1.5 text-xs font-medium text-cocoa hover:bg-sand-50"
            >
              Check again
            </button>
          </div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-palm py-3 text-sm font-semibold text-white transition hover:shadow-md disabled:opacity-60"
        >
          {saving ? (
            <>Saving…</>
          ) : saved ? (
            <>
              <CheckCircle2 size={16} /> Saved!
            </>
          ) : (
            <>
              <Save size={16} /> Save Settings
            </>
          )}
        </button>
        {saveError && <p className="flex items-center gap-1.5 text-xs font-medium text-hibiscus"><AlertCircle size={12} /> {saveError}</p>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  // If single valid element child, attach id for a11y
  const maybeChild = Array.isArray(children) ? children[0] : children;
  if (isValidElement<{ id?: string }>(maybeChild)) {
    return (
      <div>
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-cocoa-muted">
          {label}
        </label>
        {cloneElement(maybeChild, { id } as Record<string, unknown>)}
        {Array.isArray(children) ? children.slice(1) : null}
      </div>
    );
  }
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-cocoa-muted">{label}</label>
      {children}
    </div>
  );
}
