# Inventory Scanning — Design

**Date:** 2026-07-31
**Status:** Approved (user confirmed: html5-qrcode, flexible binding, inside admin SPA, direct quantity adjust)
**Depends on:** existing Orders Worker + D1 (`muy-rico-orders`), admin SPA (`home-bakery-management-system/`), Cloudflare Access auth.

## 1. Goal

Let bakery staff update inventory counts by scanning barcodes with a phone camera today, and with a USB/Bluetooth scanner gun later — without a native app. Primary workflow: periodic cycle counts (walk the shelves, scan each item, set the new on-hand count).

## 2. Non-goals (this phase)

- Count-session audit trail / change history (deferred — direct adjust only).
- Deduct-on-use automation (existing `deductOrderInventory` already handles order-driven deduction).
- A standalone mobile PWA — scanning lives inside the existing admin SPA.
- Native iOS/Android apps or scanner-gun SDKs.

## 3. Architecture fit (verified)

- **Admin SPA** is a React single-file bundle (`vite-plugin-singlefile`) served as `admin/index.html`, protected by Cloudflare Access (edge auth; worker trusts `cf-access-authenticated-user-email`). Phone scanning sits behind the same auth — no new auth work, but the phone browser must be signed into Access once.
- **Inventory table** (`orders/migrations/0004_inventory.sql`): `id, name, category, quantity, unit, reorder_level, cost_per_unit, supplier, ingredients_label, allergens, unit_weight, active, created_at, updated_at` — **no barcode column yet**.
- **Inventory API** (`orders/workers/api.js:1640-1714`): `GET/POST/PATCH/DELETE /api/inventory[/:id]`. Updates use the `INVENTORY_FIELDS` allow-list (`api.js:1623`). Add `barcode` here.
- **Label export** already uses `pdf-lib` + `qrcode` (`src/utils/labelExport.ts`); there's a `drawQrElementOffset` precedent for adding a `drawBarcodeElementOffset`.

## 4. Library & approach

| Choice | Decision |
|---|---|
| Camera library | `html5-qrcode` (Apache-2.0, ~80 KB, 0 deps) — ready-made mobile scanner UI, auto-decode all common formats |
| Scanner gun | HID-keyboard wedge — types code + `<Enter>` into a hidden focused `<input>`; same handler as camera; no SDK, no native app |
| Barcode ↔ item linking | Flexible — bind scanned supplier codes AND print our own; both flow through one `barcode` column |
| Save behavior | Direct quantity adjust via atomic `POST /api/inventory/:id/adjust {delta}` |
| Lookup endpoint shape | `GET /api/inventory/lookup?code=…` (query-param GET) |
| Adjust UI model | "Set the new count" — stepper pre-fills current qty, saves `delta = newCount − currentCount` |
| Labels | Render Code-128 with `pdf-lib` vector primitives (zero new dep) |

Supported formats (auto): Code-128, UPC-A, EAN-13/8, Code-39/93, QR, DataMatrix, PDF417.

## 5. Data model

**Migration: `orders/migrations/0030_inventory_barcode.sql`**

```sql
ALTER TABLE inventory ADD COLUMN barcode TEXT;
CREATE UNIQUE INDEX idx_inventory_barcode
  ON inventory(barcode) WHERE barcode IS NOT NULL;
UPDATE inventory SET barcode = id WHERE barcode IS NULL;
```

- `UNIQUE ... WHERE barcode IS NOT NULL`: SQLite partial index — multiple NULLs allowed, but no two items share a code. Detects duplicate binds on write (worker catches the constraint error → 409).
- Seed `barcode = id` (e.g. `inv_flour`) so cycle-counting works immediately and our printed labels can use the existing id; supplier codes overwrite it later by scanning + binding.

Add `barcode` to `INVENTORY_FIELDS` (`api.js:1623`) so `PATCH /api/inventory/:id` can set/clear it. `createInventory` INSERT column list also gets `barcode`.

## 6. Worker API changes (`orders/workers/api.js`)

1. Add `'barcode'` to `INVENTORY_FIELDS`.
2. Add `barcode` to `createInventory` INSERT column list + bind (nullable).
3. **New `GET /api/inventory/lookup?code=<code>`** → 200 `{item}` or 404. Single entry point both the camera and the gun call. Case-insensitive trim; rejects empty.
4. **New `POST /api/inventory/:id/adjust`** body `{ delta: Number }`:
   ```js
   const delta = Number(body.delta);
   if (!Number.isFinite(delta)) return json({ error: 'delta must be a number' }, 400);
   const r = await env.DB.prepare(
     `UPDATE inventory SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ? AND active = 1`
   ).bind(delta, id).run();
   if (!r.meta.changes) return json({ error: 'Not found' }, 404);
   ```
   (Fetch new quantity in the same handler to return it.)
5. Both new endpoints are admin-only — sit under the existing `im = path.match(/^\/api\/inventory/...)` style routing + Access gate.
6. PATCH that violates the unique barcode index → 409 with a clear "code already bound to <item>" message.

## 7. Admin SPA changes (`home-bakery-management-system/`)

### 7a. New `src/components/ScanModal.tsx` (lazy-loaded)
- Mount `Html5Qrcode` viewfinder with a wide-but-not-fullscreen scan box; `formatsToSupport: []` (auto/all); torch button (`showTorchButtonIfSupported`); `rememberLastUsedCamera: true`.
- **Debounce** decode callbacks (~1 s) so the same code doesn't fire twice.
- **Path on decode:**
  1. `GET /api/inventory/lookup?code=…`
  2. Hit → item card (name, category, current qty + unit) with a stepper pre-filled to current qty. On Save → `POST /api/inventory/:id/adjust {delta: newCount − currentCount}`. Toast success; keep modal open for the next item.
  3. Miss (404) → "Bind this code" UI: searchable item picker → `PATCH /api/inventory/:id {barcode: code}` (handle 409) → then proceed to step 2.
  4. Duplicate-bind (409) → "Code already on `<item>` — open that instead?" prompt.
- **Manual entry:** a visually-hidden, always-focused `<input>` capturing `keydown`/`Enter`. Used both as a fallback (type a code) and as the **scanner-gun path** (the gun types the code + Enter). Routes to the same decode handler. Input is re-focused after each action.
- **Camera lifecycle:** stops on unmount and on modal close (avoids the light staying on).

### 7b. Inventory page (`src/pages/Inventory.tsx`)
- Add a "Scan" button to the page header → opens `ScanModal` (lazy import via `React.lazy` so `html5-qrcode` is split out of the main bundle).
- Add a "Barcode" text field to the existing edit Modal (paste/typed code; placeholder "scan or type a code") wired to the same `PATCH`.

### 7c. Types & API plumbing
- `src/types.ts InventoryItem` → add `barcode?: string | null`.
- `src/utils/api.ts` → add `apiLookupInventoryByCode(code)`, `apiAdjustInventory(id, delta)`; include `barcode` in create/update payloads.

### 7d. Label printing (vector Code-128)
- New `drawBarcodeElementOffset(...)` in `src/utils/labelExport.ts` mirroring the existing `drawQrElementOffset` pattern: encode digits to bar widths via a minimal Code-128 (Code Set B/C auto) encoder, draw bars with `pdf-lib` vector primitives, draw the human-readable text below the bars. Items with no bound code fall back to their `inv_*` id.
- New `LabelElement` type `"barcode"` (parallel to `"qr"`) so labels can include a barcode element alongside text/qr/logo.

## 8. Package/bundle impact

- Add `html5-qrcode` to `home-bakery-management-system` `dependencies`.
- The admin single-file bundle grows by ~80 KB. Acceptable; mitigated by lazy-loading the scanner so it doesn't bloat the initial dashboard load.

## 9. Deployment

1. `cd home-bakery-management-system && npm install && npm run build` (postbuild copies to `admin/index.html`).
2. `npx wrangler d1 execute muy-rico-orders --remote --file=orders/migrations/0030_inventory_barcode.sql`.
3. `npx wrangler deploy -c orders/wrangler.toml` (worker: new endpoints + `barcode` allow-list + create column).
4. `npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21` then `npx wrangler versions deploy --name muyrico <VERSION>@100%` (frontend incl. new admin bundle).
5. Enroll phone browser in Cloudflare Access (sign in once) — same as opening the dashboard today.

## 10. Verification plan

- **Unit (Vitest):** `adjust` happy path + invalid `delta`; `lookup` hit/miss/empty; barcode-patch unique-conflict path.
- **End-to-end (Playwright, desktop with webcam or a test image):** bind a printed label to an item → scan → set new count → save → assert D1 row changed (`wrangler d1 execute --remote SELECT …`).
- **Gun simulation:** with modal open, dispatch `keydown` chars + `Enter` into the hidden input → assert same path executes against the API.
- **Bundle sanity:** build the SPA and confirm `admin/index.html` still inlines and loads.

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| html5-qrcode unmaintained (last release ~3 yrs) | Stable, 1.1M weekly downloads; swap to `@zxing/browser` later is a contained change behind the same `ScanModal` interface |
| iOS Safari requires HTTPS + camera permission | Already HTTPS on workers.dev; `getUserMedia` permission prompt documented |
| Scanner-gun pairs as keyboard → focus issues | Hidden input auto-refocuses on each action; modal trap keeps focus |
| Duplicate barcode binds | Unique partial index + worker 409 → modal prompts to open the existing item |
| Bundle size of single-file admin | Lazy-load `ScanModal` so scanner lib is split out of initial load |

## 12. Out of scope / later

- `inventory_adjustments` table for audit history (direct adjust now).
- PWA/installable scan app.
- Multi-code print sheets (current label export already handles per-order batches — barcode sheets can reuse it).
