import { useState } from "react";
import type { BusinessProfile } from "../../types";

export default function OnboardingModal({
  profile,
  onSave,
  onSkip,
}: {
  profile: BusinessProfile;
  onSave: (d: BusinessProfile) => void;
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
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
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
            className="rounded-lg bg-palm px-4 py-2 text-xs font-medium text-white"
          >
            {step < steps.length - 1 ? "Next" : "Start Designing"}
          </button>
        </div>
      </div>
    </div>
  );
}
