# Settings Page Fixes — Design

**Date:** 2026-09-02
**Status:** Approved

## Problem

A full audit of the admin Settings page found these defects:

1. **Fake Stripe/Apple Pay toggles.** "Stripe account connected" and "Apple Pay
   enabled" checkboxes write `stripe_connected` / `apple_pay_enabled` bits to D1
   that nothing reads. Real card payments are gated by `STRIPE_SECRET_KEY` /
   `STRIPE_PUBLISHABLE_KEY` env secrets on the checkout worker. The DB flag is
   currently `0` while Stripe is live — naively wiring the toggles would cut off
   card payments.
2. **"Reset to demo data" is a no-op.** `POST /api/seed/reset` only runs
   `INSERT OR IGNORE` on the existing `business_profile` singleton row. UI copy
   claims it restores all demo data and "cannot be undone" — both false.
3. **CashApp/Venmo handles stored but never shown.** No consumer anywhere;
   public checkout (order.html) offers only Card + PayPal tabs.
4. **"Saved!" shown on failed save.** `Settings.tsx save()` sets `saved=true`
   after the catch, which only logs.
5. **Stale draft data loss.** `draft` initialized from `profile` once with no
   re-sync; App.tsx does not gate on `loading`. If Settings mounts before the
   profile fetch resolves (or it fails), Save overwrites the server profile with
   seed defaults. The PUT is a full-overwrite upsert, amplifying the damage.
6. **Reminder settings UI lies.** Reminders save to localStorage (bell honors
   them) but Settings inputs read from `profile`, which resets `reminders` to
   seed defaults on every load. Re-saving while defaults are displayed silently
   wipes the real config.
7. **PayPal toggle can vanish permanently.** `apiToProfile` replaces seed
   `acceptedMethods` with the parsed server JSON (no key merge); server seed JSON
   lacks the `paypal` key.
8. **Minor:** cleared number inputs become 0; Save button allows double-submit;
   text inputs lack `for`/`id` label association; "stored on the server and
   shared across your devices" copy is false for reminders.

## Decisions (user-approved)

- **Stripe/Apple Pay:** show real status (read-only), driven by the checkout
  worker's existing public `GET /stripe-config` endpoint. No checkout changes.
- **CashApp/Venmo:** add a manual-pay tab to the public order page.
- **Reset:** honest, profile-scoped reset only.
- **Reminders:** persist to the backend (D1 migration), localStorage stays as
  the bell's read cache/fallback.

## Design

### 1. Settings save reliability — `Settings.tsx`

- `useEffect` re-syncs `draft` when `profile` changes.
- `save()` gains a `saving` state: button disabled while in flight, "Saved!"
  shown only on success, inline error message on failure.
- Number inputs clamped via helper: `leadDays` 1–14, `defaultSnoozeHours` ≥ 1,
  `dayStartTime` 0–23, `dayEndTime` 1–24.

### 2. Profile row mapping — new `src/utils/profile.ts`

- `mapProfileRow(row, seed)` merges server `acceptedMethods` over seed keys:
  `{ ...seed.acceptedMethods, ...parsed }` restricted to the six known
  `PaymentMethod` keys. `paypal` can never disappear.
- Merges server `reminders` through `loadReminderConfig()` semantics so the
  Settings inputs always show exactly what the bell uses.
- `StoreContext.apiToProfile` delegates to this function.

### 3. Reminders persist to backend

- Migration `orders/migrations/0043_profile_reminders.sql`:
  `ALTER TABLE business_profile ADD COLUMN reminders TEXT;`
- `PROFILE_FIELDS` in `orders/workers/api.js` gains `reminders`;
  `updateProfile` JSON-stringifies objects (same as `accepted_methods`).
- Frontend save path unchanged (already sends `reminders`); server value is now
  returned by GET and merged in `mapProfileRow`. localStorage remains a
  per-device cache so the bell works offline/first-paint.

### 4. Stripe status card — `Settings.tsx`

- Replaces both checkboxes. Fetches `GET https://muy-rico-checkout.../stripe-config`
  (public, returns `{ publishableKey }`). Shows "Connected" when a key exists,
  "Not configured" otherwise. Apple Pay shown as informational text: included
  automatically with card payments via Stripe's Payment Element.
- No writes to `stripeConnected` / `applePayEnabled`; columns stay in DB.

### 5. Honest reset — `orders/workers/api.js` + Settings copy

- `resetSeed`: `DELETE FROM business_profile WHERE id='singleton'` then re-insert
  seed **including** `website`, `business_type`, and the `paypal` key in
  `accepted_methods`.
- UI card renamed "Reset settings to defaults"; copy accurately states it resets
  only business profile settings; confirm dialog retained.

### 6. CashApp/Venmo manual-pay tab — `order.html` + `orders/workers/api.js`

- New **public** `GET /api/public/payment-options` returning only
  `{ acceptedMethods, cashtag, venmoHandle }` (no PII). Added to the public
  route exception list (CORS is already `*`).
- `order.html`: third payment tab (ES/EN) listing $cashtag and Venmo handle with
  copy-to-clipboard buttons and an "I'll send the payment" confirmation note.
  Order remains `awaiting_payment`; owner marks it paid in the dashboard. Tab
  hidden when both methods are disabled in settings. Tab is rendered after
  payment-section appears; failures degrade gracefully (tab hidden).

### 7. Accessibility & copy

- `Field` component gets `htmlFor`/`id` wiring.
- Data-management card copy no longer claims server-wide/shared-device
  semantics for reminders.

## Out of scope

- Wiring `acceptedMethods` to order.html tab visibility beyond the new
  CashApp/Venmo tab (Card/PayPal tabs remain env-driven).
- Real Stripe Connect / OAuth flow.
- Full demo-data reset of orders/products/customers.
- Hardcoded business name/phone/tagline in receipts and public pages.

## Testing

- New: `Settings.test.tsx` (save success/failure UI states, draft re-sync,
  clamp helpers), `utils/profile.test.ts` (merge semantics incl. missing
  `paypal` key, reminders merge).
- Run frontend vitest suite, backend `orders` vitest suite, `tsc --noEmit`,
  and production build (regenerates `admin/index.html`).
- Backend: extend/verify route tests where the pattern allows; migration applied
  via `wrangler d1 execute` (deploy step, user-gated).

## Deploy notes (user-gated, not auto-executed)

1. Apply migration: `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0043_profile_reminders.sql`
2. Deploy orders API: `npx wrangler deploy -c orders/wrangler.toml`
3. Deploy site assets: build admin then `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` and promote.
