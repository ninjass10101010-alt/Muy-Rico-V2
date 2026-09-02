# Settings Page Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 7 verified Settings-page defects without regressing live payments — draft-sync, Saved-on-error, paypal-merge, reminders persistence, honest Stripe status + reset, and CashApp/Venmo manual-pay.

**Architecture:** Small, isolated changes per file. Backend migration + `PROFILE_FIELDS` extension for `reminders`; new `utils/profile.ts` extracted mapping that merges acceptedMethods over seed keys; Settings gains useEffect sync, clamp helpers, disabled save + error display, Stripe-status fetch; new public `GET /api/public/payment-options`; order.html adds third tab gated on handles.

**Tech Stack:** React 19 + TypeScript + Zustand, Cloudflare Workers (D1, R2), Vite singlefile, Vitest + jsdom + Testing Library, order.html vanilla JS + Stripe.js.

## Global Constraints

- Stack versions pinned by existing repo (React 19.2, vite 7.3, vitest 4.1, `nodejs_compat`).
- No full demo-data wipe; reset stays profile-scoped.
- Live card/PayPal checkout must not be gated on DB flags (Stripe stays env-driven).
- `reminders` remains localStorage cache + backend source of truth via merge.
- Mobile + desktop parities; ES/EN i18n on order.html via `data-es/data-en`.

---

### Task 1: Backend — reminders column + honest reset

**Files:**
- Create: `orders/migrations/0043_profile_reminders.sql`
- Modify: `orders/workers/api.js:2686-2717` (PROFILE_FIELDS, updateProfile JSON handling, resetSeed), `orders/workers/api.js:90-113` (public route list + handler registration), `orders/workers/api.js:3628-3645` (resetSeed body + new getPublicPaymentOptions)

**Interfaces:**
- Consumes: `env.DB`, existing `json()`, `snakeToCamelObject()`, `getBodyField()`
- Produces: `GET /api/public/payment-options` public route; `POST /api/seed/reset` now actually resets profile row; `PUT /api/profile` handles `reminders`

- [ ] **Step 1: Create migration**

```sql
-- orders/migrations/0043_profile_reminders.sql
ALTER TABLE business_profile ADD COLUMN reminders TEXT;
```

- [ ] **Step 2: Add `reminders` to PROFILE_FIELDS + JSON handling**

```js
const PROFILE_FIELDS = [
  'name','tagline','address','phone','email','website','registration_number',
  'accepted_methods','cashtag','venmo_handle','apple_pay_enabled','stripe_connected',
  'business_type','reminders',
];
// in updateProfile loop (after accepted_methods branch):
if (f === 'reminders' && typeof val === 'object') val = JSON.stringify(val);
```

- [ ] **Step 3: Make resetSeed honest (delete+re-insert)**

```js
async function resetSeed(env, actor) {
  const seedMethods = JSON.stringify({stripe:false,paypal:false,cashapp:true,venmo:true,applepay:true,cash:true});
  await env.DB.prepare("DELETE FROM business_profile WHERE id='singleton'").run();
  await env.DB.prepare(
    `INSERT INTO business_profile (id,name,tagline,address,phone,email,registration_number,accepted_methods,cashtag,venmo_handle,apple_pay_enabled,stripe_connected,website,business_type) VALUES ('singleton','Muy Rico','Familia · Tradición · Sabor','Holland, MI','(616) 218-3582','hello@muy-rico.com','',?,'$MuyRicoBakery','@Muy-Rico',1,0,'https://muy-rico.com','cottage')`
  ).bind(seedMethods).run();
  return json({ok:true},200);
}
```

- [ ] **Step 4: Add public payment-options handler + route**

```js
// near other public consts (line ~90):
const isPublicPaymentOptions = path === '/api/public/payment-options' && method === 'GET';
// include in the Unauthorized gate's negation list
// in router (near line 304):
if (path === '/api/public/payment-options' && method === 'GET') return await getPublicPaymentOptions(env);

async function getPublicPaymentOptions(env){
  const row = await env.DB.prepare("SELECT accepted_methods,cashtag,venmo_handle FROM business_profile WHERE id='singleton'").first();
  let acceptedMethods = null;
  try{ acceptedMethods = row?.accepted_methods ? JSON.parse(row.accepted_methods) : null; }catch{}
  return json({ acceptedMethods, cashtag: row?.cashtag ?? null, venmoHandle: row?.venmo_handle ?? null },200, { 'Access-Control-Allow-Origin':'*' });
}
```

- [ ] **Step 5: Run `npm test` in orders (vitest) — expect pass**
- [ ] **Step 6: Commit**

---

### Task 2: Extract profile mapping (paypal-merge + reminders merge)

**Files:**
- Create: `home-bakery-management-system/src/utils/profile.ts`
- Modify: `home-bakery-management-system/src/context/StoreContext.tsx:1,10,468-491` (import + delegate)
- Test: `home-bakery-management-system/src/utils/profile.test.ts`

**Interfaces:**
- Consumes: `ApiBusinessProfile` (from utils/api.ts), `BusinessProfile`, `seedProfile`, `DEFAULT_REMINDER_CONFIG`, `loadReminderConfig`
- Produces: `export function mapProfileRow(row: ApiBusinessProfile | null): BusinessProfile`

- [ ] **Step 1: Write failing test — paypal survives missing server key**

```ts
import { mapProfileRow } from "./profile";
it("keeps paypal key when server JSON omits it", () => {
  const row = { name:"X", acceptedMethods: JSON.stringify({stripe:false,cashapp:true,venmo:true,applepay:true,cash:true}), cashtag:"$a", venmoHandle:"@a", applePayEnabled:1, stripeConnected:0, businessType:"cottage", website:"https://x.com", registrationNumber:"", tagline:"t", address:"a", phone:"p", email:"e", id:"singleton", updatedAt:null } as any;
  const m = mapProfileRow(row);
  expect(m.acceptedMethods.paypal).toBe(false);
});
```

- [ ] **Step 2: Run test — FAIL (function not defined)**
- [ ] **Step 3: Implement `src/utils/profile.ts`**

```ts
import { seedProfile } from "../data/seedData";
import { DEFAULT_REMINDER_CONFIG } from "../types";
import { loadReminderConfig } from "./reminders";
import type { BusinessProfile } from "../types";
import type { ApiBusinessProfile } from "./api";
const KNOWN_METHODS = Object.keys(seedProfile.acceptedMethods) as (keyof typeof seedProfile.acceptedMethods)[];
export function mapProfileRow(row: ApiBusinessProfile | null): BusinessProfile {
  if(!row) return seedProfile;
  let parsedMethods: Record<string,boolean> = {};
  try{ if(row.acceptedMethods) parsedMethods = JSON.parse(row.acceptedMethods); }catch{}
  const acceptedMethods = Object.fromEntries(KNOWN_METHODS.map(k => [k, typeof parsedMethods[k]==="boolean" ? parsedMethods[k] : seedProfile.acceptedMethods[k]])) as BusinessProfile["acceptedMethods"];
  let serverReminders: BusinessProfile["reminders"] | undefined;
  try{ if(row.reminders) { const r = typeof row.reminders==="string" ? JSON.parse(row.reminders) : row.reminders; if(r && typeof r==="object") serverReminders = r as any; } }catch{}
  const reminders = loadReminderConfig(serverReminders as any);
  return { name: row.name||seedProfile.name, tagline: row.tagline||seedProfile.tagline, address: row.address||seedProfile.address, phone: row.phone||seedProfile.phone, email: row.email||seedProfile.email, website: row.website||seedProfile.website, registrationNumber: row.registrationNumber||seedProfile.registrationNumber, businessType: row.businessType==="licensed"?"licensed":"cottage", acceptedMethods, cashtag: row.cashtag||seedProfile.cashtag, venmoHandle: row.venmoHandle||seedProfile.venmoHandle, applePayEnabled: Boolean(row.applePayEnabled), stripeConnected: Boolean(row.stripeConnected), reminders };
}
```

- [ ] **Step 4: Also extend `ApiBusinessProfile` in `utils/api.ts` with `reminders: string | null`**
- [ ] **Step 5: Update StoreContext to delegate + delete the inlined apiToProfile body**
- [ ] **Step 6: Run `npm test` — PASS**
- [ ] **Step 7: Commit**

---

### Task 3: Settings reliability + honest UI

**Files:**
- Modify: `home-bakery-management-system/src/pages/Settings.tsx` (entire file)
- Test: `home-bakery-management-system/src/pages/Settings.test.tsx` (existing suite extended)

**Interfaces:**
- Consumes: `useStore().profile/handleUpdateProfile/resetAllData`, `mapProfileRow` indirectly, `CHECKOUT_WORKER` stripe-config URL
- Produces: none (page component)

- [ ] **Step 1: Add clamp helpers + error/saving state + useEffect sync**

```tsx
import { useEffect, useId, useState } from "react";
function clampInt(v: string, min:number, max:number, fallback:number){
  if(v.trim()==="") return fallback;
  const n = Number(v); if(Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
const CHECKOUT_WORKER = "https://muy-rico-checkout.bexgarcia0208.workers.dev";
```

- [ ] **Step 2: Replace body with verified implementation (useEffect sync, saving/error, Field with id, Stripe status card, honest reset copy, number clamps)** — full file provided in task notes; verify by `tsc --noEmit`.
- [ ] **Step 3: Run `npm test` + `npx tsc --noEmit` — PASS**
- [ ] **Step 4: Commit**

---

### Task 4: order.html manual-pay tab

**Files:**
- Modify: `order.html` (payment-tabs block ~1358, payment panels, CSS for pay chips if needed, JS: switchPaymentTab, fetch /api/public/payment-options after payment-section shown)

**Interfaces:**
- Consumes: `GET /api/public/payment-options` (cross-origin `*`)
- Produces: third tab/panel with handles + copy buttons; no backend writes

- [ ] **Step 1: Add HTML — third tab + panel after existing panels**

```html
<button class="payment-tab" data-method="manual" onclick="switchPaymentTab('manual')"><span>CashApp / Venmo</span></button>
<div class="payment-panel" id="panel-manual">
  <p class="hint" data-es="Paga manualmente..." data-en="Pay manually...">...</p>
  <div id="manual-handles"></div>
  <button id="manual-confirm-btn" class="btn">I've sent the payment</button>
  <p id="manual-note" class="hint"></p>
</div>
```

- [ ] **Step 2: JS — after payment-section display, fetch payment-options and populate handles; hide tab if both disabled; wire copy buttons with navigator.clipboard + fallback**
- [ ] **Step 3: Manual visual check (open order.html locally, submit test order, verify tab)**
- [ ] **Step 4: Commit**

---

### Task 5: Build + verification

- [ ] **Step 1:** `npm run build` in home-bakery-management-system (regenerates `admin/index.html`)
- [ ] **Step 2:** `npm test` in both workspaces + `npx tsc --noEmit -p tsconfig.json`
- [ ] **Step 3:** Subagent review via `requesting-code-review`
- [ ] **Step 4:** Commit `admin/index.html` if changed
