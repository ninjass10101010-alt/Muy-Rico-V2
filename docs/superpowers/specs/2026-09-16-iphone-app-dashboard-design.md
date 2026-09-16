# iPhone home-screen dashboard app — design

**Date:** 2026-09-16
**Goal:** Launch the Muy Rico owner dashboard from an iPhone home-screen icon like a native app, with instant access after a one-time sign-in.

## Background

The dashboard (`/admin/`) is a single-file React SPA served by the `muyrico` assets
worker. It is protected by **Cloudflare Access** with a one-time PIN (OTP) identity
provider, allowlisting two owner emails. The API worker (`muy-rico-orders-api`,
source `orders/workers/api.js`) resolves identity from, in order: the
`cf-access-authenticated-user-email` header, or the `CF_Authorization` JWT cookie.

Two things block an app-like experience today:

1. **No app shell** — the SPA HTML has no web-app manifest, no Apple touch icon, and
   no `display: standalone`/`apple-mobile-web-app-capable`, so "Add to Home Screen"
   just opens a Safari bookmark with full browser chrome.
2. **OTP fights the app model** — Access gates the *page load* of `/admin/*`. iOS
   home-screen apps do not reliably persist the `CF_Authorization` session cookie, so
   the OTP interstitial can appear on nearly every launch.

## Approach

Keep Cloudflare Access as the *trust anchor* that proves identity, but stop gating
every launch on it. Add a **trusted-device token**: after one Access-authenticated
sign-in, the API mints a long-lived token the app stores on-device and presents as a
`Bearer` credential. Access remains the only way to obtain a token, so the security
posture is preserved.

## Architecture — two routes, one trust anchor

| Route | Access-protected? | Purpose |
|---|---|---|
| `/app/*` (new) | **No** | Home-screen app. Always loads the shell; authenticates with a device token. |
| `/admin/*` (unchanged) | Yes (OTP) | Desktop flow as-is **and** the one-time bootstrap that mints a device token. |

- `_redirects` gains `/app/* /admin/index.html 200` — the **same** single-file bundle
  is served at `/app/`, so there is no second build and no duplicated asset. The SPA
  router already branches on `window.location.pathname`; `/app/` renders the admin app.
- The shell contains no data — every byte of customer/payment info still requires a
  valid token at the API. A public shell with an authenticated API is how every SPA
  works.
- Implementation note: verify Workers Assets honors a `200` rewrite whose target is
  outside the matched prefix (low risk; confirm at build time).

## Trusted-device token

- 32 random bytes (`crypto.getRandomValues`), base64url → 256-bit entropy.
- D1 stores **SHA-256** of the token, never the raw token.
- **90-day rolling expiry**, refreshed on each authenticated use, so an app in regular
  use never forces re-login. Abandoned ~90 days → OTP again.
- Max **10 active tokens per email**.
- Client stores the token in `localStorage` **and** IndexedDB, reading from either on
  boot — iOS evicts standalone storage unpredictably and dual-write materially
  improves persistence.

### Migration `0046_device_tokens.sql`

```sql
CREATE TABLE device_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_device_tokens_email ON device_tokens(user_email);
```

### API worker changes (`orders/workers/api.js`)

The single auth block at the top of `fetch()` gains a third identity source. Resolve
order: **Access header → Access cookie → Bearer device token**. One change covers every
endpoint because they all funnel through this gate. A token resolves identity only if
`revoked = 0` and `expires_at > now`; on success, `last_used_at` and `expires_at` are
rolled forward 90 days.

### New endpoints (all require an Access session **or** a valid device token)

| Method + path | Purpose |
|---|---|
| `POST /api/auth/device-token` | Mint a token. Requires an Access session (header or cookie). Trust the Access-issued email (already allowlist-enforced). Returns `{ token, expiresAt }`. |
| `GET /api/auth/verify` | Boot-time token check. Returns `{ email, expiresAt }`. |
| `GET /api/auth/devices` | List active (non-revoked) tokens for the caller's email. |
| `POST /api/auth/devices/:id/revoke` | Revoke one device token belonging to the caller's email. |
| `POST /api/auth/revoke-all` | Revoke every token for the caller's email ("sign out everywhere"). |

## Flows

- **First run:** tap icon → `/app/` loads → no token → **Sign-in screen**. "Sign in
  with email PIN" navigates to `/admin/?mint=1` → Access shows OTP (once) and sets the
  `CF_Authorization` cookie → the SPA sees `?mint=1` and calls
  `POST /api/auth/device-token` (cookie-validated) → stores the token → redirects to
  `/app/`.
- **Silent mint:** the Sign-in screen first attempts `POST /api/auth/device-token`
  before showing the OTP button; if a session cookie already exists (e.g. desktop
  users, or a phone that just completed OTP elsewhere), sign-in completes with zero
  friction.
- **Later runs:** token found → Bearer on every call → instant dashboard.
- **Global 401:** clear the stored token and return to the Sign-in screen.

## SPA changes (`home-bakery-management-system/src/`)

- `utils/tokenStore.ts` — get/set/clear across `localStorage` + IndexedDB.
- `utils/api.ts` — `apiFetch` attaches `Authorization: Bearer <token>` when present; a
  global `401` clears the token and surfaces the login screen.
- `context/AuthContext.tsx` — on boot, read the token → `GET /api/auth/verify` →
  render the app or `<LoginScreen>`; also handles the `?mint=1` handshake.
- `components/LoginScreen.tsx` — branded sign-in: silent-mint attempt, then the PIN
  button linking to `/admin/?mint=1`.
- `pages/Settings.tsx` — new **Trusted Devices** panel: per-device label (auto-derived
  from User-Agent, e.g. "iPhone · Safari"), last used, expiry, per-row **Revoke**, plus
  **Sign out of all devices**.
- `components/Topbar.tsx` (optional) — a "Sign out" action that revokes the current
  device token.

## Installable PWA shell

`home-bakery-management-system/index.html` gains:

- `<link rel="manifest">` with `display: standalone`, `start_url: /app/`, `scope: /app/`.
- Apple metas: `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-status-bar-style`,
  `apple-mobile-web-app-title`, `<link rel="apple-touch-icon">`.
- `viewport-fit=cover` on the viewport meta for notch safe areas.

The manifest + PNG icons (180/192/512) live in the **repo root**, referenced by absolute
URL. This is deliberate: `postbuild.sh` only copies `dist/index.html` to
`admin/index.html`, and the `muyrico` assets worker serves the repo root, so root-level
PWA files are served with **zero build-pipeline changes**. Icons are generated from the
existing `muy_rico_logo_transparent.webp` (the 🍩 emoji favicon stays as the desktop
favicon). No Service Worker — the dashboard needs live data, so offline adds nothing.

## Phasing & rollout

- **Phase 1 (immediate win, low risk):** PWA shell + `_redirects` `/app/` route +
  extend the Access session duration in the dashboard. Home screen already feels like
  an app.
- **Phase 2:** device tokens → guaranteed instant access regardless of iOS cookie
  behavior.
- **Deploy:** run migration `0046` (local + remote), rebuild the SPA
  (`npm run build` → `admin/index.html`), redeploy the `muyrico` assets worker and
  `muy-rico-orders-api`. The Access policy already covers `/admin*`; `/app*` is simply
  not in it, so no policy change is required.
- **Owner setup (manual):** on the iPhone, open `muy-rico.com/app/`, sign in once
  (OTP), then Share → Add to Home Screen. A QR code pointing at `/app/` makes this
  painless.

## Testing & verification

- `vitest`: unit tests for `tokenStore` (dual-store read/write/clear), the `?mint=1`
  handshake, and 401 → logout behavior.
- Worker-level tests for the auth block: valid / invalid / expired / revoked tokens,
  and that a mint without an Access session is rejected.
- Manual iOS checklist: first-run OTP → mint → instant relaunch; revoke from Settings
  forces re-login; `/admin/` desktop flow unchanged.

## Security considerations

- Tokens are 256-bit and stored hashed, so a D1 leak exposes nothing usable.
- Token issuance is only possible with an Access-authenticated request; the email
  allowlist is enforced by Access at `/admin*`.
- Bearer is only ever sent over HTTPS (the site is HTTPS-only).
- Revocation is available per-device and globally from Settings.
