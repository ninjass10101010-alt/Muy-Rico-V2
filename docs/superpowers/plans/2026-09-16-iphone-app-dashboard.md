# iPhone home-screen dashboard app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner launch the Muy Rico dashboard from an iPhone home-screen icon like a native app, with instant access after a one-time email-PIN sign-in.

**Architecture:** Add an ungated `/app/` route serving the same single-file SPA shell. Cloudflare Access stops gating every launch and becomes the one-time trust anchor: after a single OTP, the API mints a 90-day rolling trusted-device token that the SPA stores locally (localStorage + IndexedDB) and presents as a `Bearer` credential. The API worker resolves identity in order: Access header → Access cookie → device token.

**Tech Stack:** Cloudflare Workers + D1 (SQLite), React 19 + Vite + Tailwind 4 single-file SPA, Web Crypto, web app manifest + Apple PWA meta tags, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-iphone-app-dashboard-design.md`

## Global Constraints

- Token lifetime is **90 days, rolling** (refreshed on each authenticated use).
- Store only **SHA-256** of tokens in D1, never raw tokens.
- Max **10 active tokens per email**.
- Identity resolution order in the API auth gate: **Access header → Access cookie → Bearer token**.
- The `/app/*` route must **not** be in the Cloudflare Access policy; `/admin*` stays protected.
- PWA assets live in the **repo root** and are referenced by absolute URL (the `muyrico` assets worker serves the repo root; `postbuild.sh` only copies `dist/index.html`).
- No Service Worker (the dashboard needs live data).
- Never commit secrets. Never hardcode credentials.

---

## File map

**Worker (`orders/`)**
- Create `migrations/0046_device_tokens.sql` — token table.
- Create `workers/device-token-lib.js` — crypto + D1 helpers (mint/resolve/list/revoke).
- Modify `workers/api.js` — Bearer identity source + 5 auth endpoints.
- Create `tests/device-token-lib.test.js` — library tests with a fake D1.

**SPA (`home-bakery-management-system/`)**
- Modify `index.html` — manifest link, Apple PWA metas, `viewport-fit=cover`.
- Create `src/utils/tokenStore.ts` — localStorage + IndexedDB token storage.
- Modify `src/utils/api.ts` — Bearer header on every call + global 401 logout.
- Create `src/context/AuthContext.tsx` — boot verify / silent mint / `?mint=1` handshake.
- Create `src/components/LoginScreen.tsx` — branded sign-in.
- Modify `src/App.tsx` — wrap in `AuthProvider`, gate on auth status.
- Modify `src/pages/Settings.tsx` — Trusted Devices panel.
- Modify `src/components/Topbar.tsx` — Sign out action.
- Create `src/utils/tokenStore.test.ts` — storage tests.

**Repo root (PWA assets, served statically)**
- Create `manifest.webmanifest`, `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`.
- Create `generate_pwa_icons.py` — one-off icon generator (matches existing `generate_svgs.py` convention).
- Modify `_redirects` — `/app/* /admin/index.html 200`.

---

## Task 1: PWA manifest, icons, and HTML shell

**Files:**
- Create: `manifest.webmanifest`, `generate_pwa_icons.py`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`
- Modify: `home-bakery-management-system/index.html`

**Interfaces:** Produces the installable shell consumed by every later task (no code dependencies).

- [ ] **Step 1: Create `manifest.webmanifest`**

```json
{
  "name": "Muy Rico Dashboard",
  "short_name": "Muy Rico",
  "description": "Muy Rico bakery owner dashboard",
  "start_url": "/app/",
  "scope": "/app/",
  "display": "standalone",
  "background_color": "#FAF6EC",
  "theme_color": "#1E4636",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Create `generate_pwa_icons.py`** (Pillow is installed; composites the logo onto an opaque cream background so iOS renders a proper home-screen icon)

```python
#!/usr/bin/env python3
"""Generate PWA/home-screen icons from the Muy Rico logo."""
import sys
from PIL import Image

SRC = "muy_rico_logo_transparent.webp"
BG = (250, 246, 236, 255)  # sand #FAF6EC, opaque

OUT = {
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}

def main():
    logo = Image.open(SRC).convert("RGBA")
    for name, size in OUT.items():
        canvas = Image.new("RGBA", (size, size), BG)
        # Fit logo to ~78% of the canvas, centered.
        s = int(size * 0.78)
        scaled = logo.resize((s, s), Image.LANCZOS)
        x = (size - s) // 2
        canvas.paste(scaled, (x, x), scaled)
        canvas.convert("RGB").save(name, "PNG")
        print(f"wrote {name} ({size}x{size})")

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 3: Generate the icons**

Run: `python3 generate_pwa_icons.py`
Expected: writes `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`.

- [ ] **Step 4: Update `home-bakery-management-system/index.html`** head (keep existing fonts/favicon links)

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#1E4636" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="Muy Rico" />
```

- [ ] **Step 5: Commit**

```bash
git add manifest.webmanifest generate_pwa_icons.py apple-touch-icon.png icon-192.png icon-512.png home-bakery-management-system/index.html
git commit -m "feat(pwa): installable shell for the dashboard"
```

---

## Task 2: `/app/` route

**Files:**
- Modify: `home-bakery-management-system/postbuild.sh`

**Interfaces:** Produces the ungated URL the home-screen icon opens.

> **Routing note (deviation from original design):** Workers Assets *rejects* a
> `_redirects` rule of `/app/* /admin/index.html 200` ("Infinite loop detected … strip
> .html"). The implemented approach is to serve a real `app/index.html` copy of the same
> bundle instead — `postbuild.sh` now writes both `../admin/index.html` and
> `../app/index.html`. `App.tsx`'s router defaults any non-`/admin/order` path to
> `<AdminApp />`, so `/app/` renders the dashboard with no code change.

- [ ] **Step 1: Emit the bundle at `/app/` too**

`postbuild.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p ../admin ../app
cp dist/index.html ../admin/index.html
cp dist/index.html ../app/index.html
```

- [ ] **Step 2: Confirm `AppRouter` already handles `/app/`** — `App.tsx` defaults any non-`/admin/order` path to `<AdminApp />`. Verify by reading the file.

- [ ] **Step 3: Commit**

```bash
git add home-bakery-management-system/postbuild.sh
git commit -m "feat(app): serve dashboard SPA at ungated /app/ route"
```

---

## Task 3: `device_tokens` migration

**Files:**
- Create: `orders/migrations/0046_device_tokens.sql`

**Interfaces:** Produces the `device_tokens` table consumed by Task 4.

- [ ] **Step 1: Write the migration**

```sql
-- Muy Rico — trusted-device tokens for the home-screen dashboard app.
-- Tokens are 256-bit random values; this table stores only their SHA-256 digest.
-- Run:
--   npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0046_device_tokens.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0046_device_tokens.sql

CREATE TABLE IF NOT EXISTS device_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email   TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  label        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_email ON device_tokens(user_email);
```

- [ ] **Step 2: Apply locally**

Run: `npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0046_device_tokens.sql`
Expected: `device_tokens` table created (wrangler prints the executed statement).

- [ ] **Step 3: Commit**

```bash
git add orders/migrations/0046_device_tokens.sql
git commit -m "feat(db): device_tokens table for trusted devices"
```

---

## Task 4: Token library + tests (TDD)

**Files:**
- Create: `orders/workers/device-token-lib.js`
- Test: `orders/tests/device-token-lib.test.js`

**Interfaces:**
- Produces: `generateDeviceToken(): string`, `hashToken(t): Promise<string>`, `mintDeviceToken(env, email, label): Promise<{token, expiresAt}>`, `resolveDeviceToken(env, token): Promise<{id, email, expiresAt}|null>`, `listDevices(env, email): Promise<Row[]>`, `revokeDevice(env, email, id): Promise<boolean>`, `revokeAllDevices(env, email): Promise<void>`.
- Consumes: `env.DB` (D1 binding from Task 3).

- [ ] **Step 1: Write `orders/tests/device-token-lib.test.js`**

```js
import { describe, it, expect } from 'vitest';
import {
  generateDeviceToken, hashToken,
  mintDeviceToken, resolveDeviceToken, listDevices,
  revokeDevice, revokeAllDevices,
} from '../workers/device-token-lib.js';

// Minimal fake D1 that interprets exactly the SQL this library issues.
function makeFakeDb() {
  const tokens = [];
  let seq = 1;
  const now = () => new Date().toISOString();
  const ok = { meta: { changes: 1 } };
  const bind = (sql, vals) => {
    const up = sql.toUpperCase();
    if (up.includes('INSERT INTO DEVICE_TOKENS')) {
      const [user_email, token_hash, label, expires_at] = vals;
      const row = { id: seq++, user_email, token_hash, label, created_at: now(), last_used_at: now(), expires_at, revoked: 0 };
      tokens.push(row);
      return { run: async () => ok, first: async () => row, all: async () => ({ results: [] }) };
    }
    if (up.includes('SELECT COUNT(*)')) {
      const c = tokens.filter((r) => r.user_email === vals[0] && !r.revoked).length;
      return { run: async () => ({ meta: { changes: 0 } }), first: async () => ({ c }), all: async () => ({ results: [] }) };
    }
    if (up.startsWith('SELECT ID, USER_EMAIL')) {
      const row = tokens.find((r) => r.token_hash === vals[0] && !r.revoked) || null;
      return { run: async () => ({ meta: { changes: 0 } }), first: async () => row, all: async () => ({ results: [] }) };
    }
    if (up.startsWith('SELECT ID, LABEL')) {
      const results = tokens.filter((r) => r.user_email === vals[0] && !r.revoked).sort((a, b) => b.id - a.id);
      return { run: async () => ({ meta: { changes: 0 } }), first: async () => null, all: async () => ({ results }) };
    }
    if (up.startsWith('UPDATE DEVICE_TOKENS SET LAST_USED_AT')) {
      const row = tokens.find((r) => r.id === vals[1]);
      if (row) { row.last_used_at = now(); row.expires_at = vals[0]; }
      return { run: async () => ({ meta: { changes: row ? 1 : 0 } }), first: async () => null, all: async () => ({ results: [] }) };
    }
    if (up.startsWith('UPDATE DEVICE_TOKENS SET REVOKED = 1 WHERE ID')) {
      const row = tokens.find((r) => r.id === vals[0] && r.user_email === vals[1] && !r.revoked);
      if (row) row.revoked = 1;
      return { run: async () => ({ meta: { changes: row ? 1 : 0 } }), first: async () => null, all: async () => ({ results: [] }) };
    }
    if (up.startsWith('UPDATE DEVICE_TOKENS SET REVOKED = 1 WHERE USER_EMAIL')) {
      tokens.forEach((r) => { if (r.user_email === vals[0] && !r.revoked) r.revoked = 1; });
      return { run: async () => ok, first: async () => null, all: async () => ({ results: [] }) };
    }
    // DELETE hygiene statements are no-ops in the fake.
    return { run: async () => ({ meta: { changes: 0 } }), first: async () => null, all: async () => ({ results: [] }) };
  };
  return { prepare: (sql) => ({ bind: (...v) => bind(sql, v) }), tokens };
}

describe('generateDeviceToken', () => {
  it('is url-safe base64 and unique', () => {
    const a = generateDeviceToken();
    const b = generateDeviceToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('is deterministic 64-char hex', async () => {
    const h = await hashToken('abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken('abc')).toBe(h);
    expect(await hashToken('abd')).not.toBe(h);
  });
});

describe('mint + resolve + revoke', () => {
  it('mints a token that resolves to its email and rolls expiry', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const { token, expiresAt } = await mintDeviceToken(env, 'jeff@example.com', 'iPhone · Safari');
    expect(token).toBeTruthy();
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    const record = await resolveDeviceToken(env, token);
    expect(record.email).toBe('jeff@example.com');
  });

  it('rejects an unknown token', async () => {
    const db = makeFakeDb();
    expect(await resolveDeviceToken({ DB: db }, 'nope')).toBeNull();
  });

  it('revoking a token invalidates it', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const { token } = await mintDeviceToken(env, 'bex@example.com', 'Pixel');
    const record = await resolveDeviceToken(env, token);
    expect(await revokeDevice(env, 'bex@example.com', record.id)).toBe(true);
    expect(await resolveDeviceToken(env, token)).toBeNull();
  });

  it('revokeAllDevices invalidates every token for the email', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    const a = await mintDeviceToken(env, 'jeff@example.com', 'a');
    const b = await mintDeviceToken(env, 'jeff@example.com', 'b');
    await revokeAllDevices(env, 'jeff@example.com');
    expect(await resolveDeviceToken(env, a.token)).toBeNull();
    expect(await resolveDeviceToken(env, b.token)).toBeNull();
  });

  it('caps active tokens per email at 10', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    for (let i = 0; i < 12; i++) await mintDeviceToken(env, 'jeff@example.com', `d${i}`);
    const devices = await listDevices(env, 'jeff@example.com');
    expect(devices.length).toBe(10);
  });

  it('listDevices returns only the caller email\'s active tokens', async () => {
    const db = makeFakeDb();
    const env = { DB: db };
    await mintDeviceToken(env, 'jeff@example.com', 'jeff-phone');
    await mintDeviceToken(env, 'bex@example.com', 'bex-phone');
    expect((await listDevices(env, 'bex@example.com')).map((d) => d.label)).toEqual(['bex-phone']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd orders && npx vitest run tests/device-token-lib.test.js`
Expected: FAIL — module `../workers/device-token-lib.js` not found.

- [ ] **Step 3: Write `orders/workers/device-token-lib.js`**

```js
// Trusted-device tokens for the Muy Rico dashboard home-screen app.
// Tokens are 256-bit random values; D1 stores only their SHA-256 digest.

const TOKEN_TTL_DAYS = 90;
const MAX_ACTIVE_TOKENS_PER_EMAIL = 10;

const encoder = new TextEncoder();

/** Random 256-bit token, base64url-encoded. */
export function generateDeviceToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** SHA-256 hex digest of a token (the only thing we persist). */
export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isoPlusDays(days) {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

/**
 * Mint a device token for `email`. Enforces the per-email active cap by
 * evicting the oldest tokens. Returns { token, expiresAt }.
 */
export async function mintDeviceToken(env, email, label) {
  const token = generateDeviceToken();
  const tokenHash = await hashToken(token);
  const expiresAt = isoPlusDays(TOKEN_TTL_DAYS);

  await env.DB.prepare(
    'DELETE FROM device_tokens WHERE user_email = ? AND revoked = 1'
  ).bind(email).run();

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM device_tokens WHERE user_email = ? AND revoked = 0'
  ).bind(email).first();
  if ((countRow?.c ?? 0) >= MAX_ACTIVE_TOKENS_PER_EMAIL) {
    await env.DB.prepare(
      `DELETE FROM device_tokens
       WHERE user_email = ? AND revoked = 0
         AND id NOT IN (
           SELECT id FROM device_tokens WHERE user_email = ? AND revoked = 0
           ORDER BY id DESC LIMIT ?
         )`
    ).bind(email, email, MAX_ACTIVE_TOKENS_PER_EMAIL - 1).run();
  }

  await env.DB.prepare(
    'INSERT INTO device_tokens (user_email, token_hash, label, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(email, tokenHash, label || null, expiresAt).run();

  return { token, expiresAt };
}

/**
 * Validate a presented token and roll its 90-day expiry forward.
 * Returns { id, email, expiresAt } or null when invalid/expired/revoked.
 */
export async function resolveDeviceToken(env, token) {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    'SELECT id, user_email, expires_at FROM device_tokens WHERE token_hash = ? AND revoked = 0'
  ).bind(tokenHash).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const expiresAt = isoPlusDays(TOKEN_TTL_DAYS);
  await env.DB.prepare(
    "UPDATE device_tokens SET last_used_at = datetime('now'), expires_at = ? WHERE id = ?"
  ).bind(expiresAt, row.id).run();

  return { id: row.id, email: row.user_email, expiresAt };
}

export async function listDevices(env, email) {
  const { results } = await env.DB.prepare(
    'SELECT id, label, created_at, last_used_at, expires_at FROM device_tokens WHERE user_email = ? AND revoked = 0 ORDER BY id DESC'
  ).bind(email).all();
  return results;
}

export async function revokeDevice(env, email, tokenId) {
  const out = await env.DB.prepare(
    'UPDATE device_tokens SET revoked = 1 WHERE id = ? AND user_email = ?'
  ).bind(tokenId, email).run();
  return (out.meta?.changes ?? 0) > 0;
}

export async function revokeAllDevices(env, email) {
  await env.DB.prepare(
    'UPDATE device_tokens SET revoked = 1 WHERE user_email = ? AND revoked = 0'
  ).bind(email).run();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd orders && npx vitest run tests/device-token-lib.test.js`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Commit**

```bash
git add orders/workers/device-token-lib.js orders/tests/device-token-lib.test.js
git commit -m "feat(auth): trusted-device token library"
```

---

## Task 5: API worker — Bearer identity + auth endpoints

**Files:**
- Modify: `orders/workers/api.js` (auth block ~lines 81-132; routing ~lines 134-140; new handler functions near `emailFromAccessCookie`)

**Interfaces:**
- Consumes: `device-token-lib.js` (Task 4), `env.DB`.
- Produces: `POST /api/auth/device-token`, `GET /api/auth/verify`, `GET /api/auth/devices`, `POST /api/auth/devices/:id/revoke`, `POST /api/auth/revoke-all`, `DELETE /api/auth/device-token` (revoke current).

- [ ] **Step 1: Import the token library** (next to the other `import` statements at the top of `api.js`)

```js
import {
  mintDeviceToken, resolveDeviceToken, listDevices, revokeDevice, revokeAllDevices,
} from './device-token-lib.js';
```

- [ ] **Step 2: Add Bearer as the third identity source** in the auth block, between the header check and the cookie fallback

```js
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    let actorEmail = isLocal ? 'local@dev' : (request.headers.get('cf-access-authenticated-user-email') || '');
    if (!actorEmail && !isLocal) {
      const bearer = (request.headers.get('Authorization') || '').trim();
      if (bearer.toLowerCase().startsWith('bearer ')) {
        const record = await resolveDeviceToken(env, bearer.slice(7).trim());
        if (record) actorEmail = record.email;
      }
    }
    if (!actorEmail && !isLocal) {
      actorEmail = emailFromAccessCookie(request) || '';
    }
```

- [ ] **Step 3: Register the auth routes** (immediately after the existing `if (method === 'OPTIONS') …` / before the public-route gate, or with the other route registrations — they run after the Access gate returns 401 for unauthenticated callers)

```js
    if (path === '/api/auth/device-token' && method === 'POST') return await mintDeviceTokenHandler(request, env, actorEmail);
    if (path === '/api/auth/device-token' && method === 'DELETE') return await revokeCurrentDeviceHandler(request, env);
    if (path === '/api/auth/verify' && method === 'GET') return await verifyTokenHandler(request, env, actorEmail);
    if (path === '/api/auth/devices' && method === 'GET') return await listDevicesHandler(env, actorEmail);
    if (path.match(/^\/api\/auth\/devices\/\d+\/revoke$/) && method === 'POST') return await revokeDeviceHandler(request, env, actorEmail, path);
    if (path === '/api/auth/revoke-all' && method === 'POST') return await revokeAllDevicesHandler(env, actorEmail);
```

- [ ] **Step 4: Add the handlers** (place near `emailFromAccessCookie`)

```js
function describeUserAgent(ua) {
  if (!ua) return 'Device';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const m = /(Chrome|CriOS|Firefox|FxiOS|Safari|EdgiOS)/i.exec(ua);
  return `${isIOS ? 'iPhone' : 'Device'} · ${m ? m[1] : 'Browser'}`;
}

async function mintDeviceTokenHandler(request, env, actorEmail) {
  if (!actorEmail) return json({ error: 'Unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const label = typeof body.label === 'string' && body.label.trim()
    ? body.label.trim().slice(0, 100)
    : describeUserAgent(request.headers.get('User-Agent'));
  const { token, expiresAt } = await mintDeviceToken(env, actorEmail, label);
  return json({ token, expiresAt });
}

async function verifyTokenHandler(request, env, actorEmail) {
  if (!actorEmail) return json({ error: 'Unauthorized' }, 401);
  const bearer = (request.headers.get('Authorization') || '').trim();
  if (bearer.toLowerCase().startsWith('bearer ')) {
    const record = await resolveDeviceToken(env, bearer.slice(7).trim());
    if (record) return json({ email: record.email, expiresAt: record.expiresAt });
  }
  return json({ email: actorEmail });
}

async function listDevicesHandler(env, actorEmail) {
  if (!actorEmail) return json({ error: 'Unauthorized' }, 401);
  return json({ devices: await listDevices(env, actorEmail) });
}

async function revokeDeviceHandler(request, env, actorEmail, path) {
  if (!actorEmail) return json({ error: 'Unauthorized' }, 401);
  const id = Number(path.match(/\/api\/auth\/devices\/(\d+)\/revoke/)[1]);
  const ok = await revokeDevice(env, actorEmail, id);
  return json({ ok });
}

async function revokeAllDevicesHandler(env, actorEmail) {
  if (!actorEmail) return json({ error: 'Unauthorized' }, 401);
  await revokeAllDevices(env, actorEmail);
  return json({ ok: true });
}

async function revokeCurrentDeviceHandler(request, env) {
  const bearer = (request.headers.get('Authorization') || '').trim();
  const raw = bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '';
  const record = await resolveDeviceToken(env, raw);
  if (!record) return json({ error: 'Unauthorized' }, 401);
  await revokeDevice(env, record.email, record.id);
  return json({ ok: true });
}
```

- [ ] **Step 5: Run the full worker test suite**

Run: `cd orders && npx vitest run`
Expected: PASS — existing tests plus the new device-token tests.

- [ ] **Step 6: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(api): Bearer device-token auth + trusted-device endpoints"
```

---

## Task 6: SPA token store + tests (TDD)

**Files:**
- Create: `home-bakery-management-system/src/utils/tokenStore.ts`
- Test: `home-bakery-management-system/src/utils/tokenStore.test.ts`

**Interfaces:**
- Produces: `getDeviceToken(): Promise<string|null>`, `setDeviceToken(t): Promise<void>`, `clearDeviceToken(): Promise<void>`.
- Consumed by: `api.ts` (Task 7), `AuthContext.tsx` (Task 8).

- [ ] **Step 1: Write the failing test** (jsdom env; `localStorage` is available, IndexedDB is not — the module must degrade gracefully)

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getDeviceToken, setDeviceToken, clearDeviceToken } from "./tokenStore";

describe("tokenStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a token through localStorage", async () => {
    expect(await getDeviceToken()).toBeNull();
    await setDeviceToken("abc123");
    expect(await getDeviceToken()).toBe("abc123");
  });

  it("clears a stored token", async () => {
    await setDeviceToken("abc123");
    await clearDeviceToken();
    expect(await getDeviceToken()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd home-bakery-management-system && npx vitest run src/utils/tokenStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/utils/tokenStore.ts`**

```ts
const LS_KEY = "muyrico.deviceToken";
const IDB_NAME = "muyrico-auth";
const IDB_STORE = "tokens";
const IDB_KEY = "deviceToken";

let idbBroken = false;

function openDb(): Promise<IDBDatabase | null> {
  if (idbBroken || typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        idbBroken = true;
        resolve(null);
      };
    } catch {
      idbBroken = true;
      resolve(null);
    }
  });
}

async function idbSet(value: string | null): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    if (value === null) store.delete(IDB_KEY);
    else store.put(value, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

async function idbGet(): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  const value = await new Promise<string | null>((resolve) => {
    const req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return value;
}

/**
 * Read the device token, preferring localStorage. If only IndexedDB has it
 * (iOS evicted localStorage), repair localStorage on the way through.
 */
export async function getDeviceToken(): Promise<string | null> {
  let ls: string | null = null;
  try {
    ls = typeof localStorage !== "undefined" ? localStorage.getItem(LS_KEY) : null;
  } catch {
    ls = null;
  }
  if (ls) return ls;

  const idb = await idbGet();
  if (idb) {
    try {
      localStorage.setItem(LS_KEY, idb);
    } catch {
      /* storage unavailable; IndexedDB copy still works */
    }
  }
  return idb;
}

export async function setDeviceToken(token: string): Promise<void> {
  try {
    localStorage.setItem(LS_KEY, token);
  } catch {
    /* ignore */
  }
  await idbSet(token);
}

export async function clearDeviceToken(): Promise<void> {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  await idbSet(null);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd home-bakery-management-system && npx vitest run src/utils/tokenStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/utils/tokenStore.ts home-bakery-management-system/src/utils/tokenStore.test.ts
git commit -m "feat(spa): dual-store device token storage"
```

---

## Task 7: Bearer auth in `api.ts` + global 401 logout

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts`

**Interfaces:**
- Consumes: `tokenStore` (Task 6).
- Produces: `setUnauthorizedHandler(fn)` (wired by Task 8), plus exported device API helpers: `fetchDevices()`, `revokeDeviceApi(id)`, `signOutCurrentDeviceApi()`, `mintDeviceTokenApi(label?)`.

- [ ] **Step 1: Add imports and an unauthorized hook** at the top of `api.ts`

```ts
import { getDeviceToken, clearDeviceToken } from "./tokenStore";

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await getDeviceToken();
  const headers = { ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}
```

- [ ] **Step 2: Send the Bearer header and handle 401** in `apiFetch`

```ts
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = await authHeaders(
    (options?.headers as Record<string, string>) || {}
  );
  if (!headers["Content-Type"] && !(options?.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    await clearDeviceToken();
    if (onUnauthorized) onUnauthorized();
  }
  if (!res.ok) {
    let errorMsg = `API error ${res.status}`;
    let errBody: any = null;
    try {
      errBody = await res.json();
      errorMsg = errBody.error || errorMsg;
    } catch {}
    const err: any = new Error(errorMsg);
    err.status = res.status;
    err.body = errBody;
    throw err;
  }
  const data = await res.json();
  return data as T;
}
```

- [ ] **Step 3: Add the Bearer header to the two raw `fetch` uploads** (`uploadImage`, `uploadQuoteImage`) by replacing their `fetch(...)` calls with

```ts
  const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form, headers: await authHeaders() });
```
```ts
  const res = await fetch(`${API_BASE}/api/quotes/upload-image`, { method: 'POST', body: form, headers: await authHeaders() });
```

- [ ] **Step 4: Add device API helpers** (append near the end of the file)

```ts
// ─── Trusted devices (home-screen app auth) ────────────────────────────────

export interface DeviceInfo {
  id: number;
  label: string | null;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

export async function mintDeviceTokenApi(label?: string): Promise<{ token: string; expiresAt: string }> {
  return apiFetch("/api/auth/device-token", { method: "POST", body: JSON.stringify({ label }) });
}

export async function fetchDevices(): Promise<DeviceInfo[]> {
  const data = await apiFetch<{ devices: DeviceInfo[] }>("/api/auth/devices");
  return data.devices;
}

export async function revokeDeviceApi(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/auth/devices/${id}/revoke`, { method: "POST" });
}

export async function signOutCurrentDeviceApi(): Promise<{ ok: boolean }> {
  return apiFetch("/api/auth/device-token", { method: "DELETE" });
}
```

- [ ] **Step 5: Typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts
git commit -m "feat(spa): Bearer token auth + global 401 logout"
```

---

## Task 8: `AuthContext` + `LoginScreen` + app gate

**Files:**
- Create: `home-bakery-management-system/src/context/AuthContext.tsx`
- Create: `home-bakery-management-system/src/components/LoginScreen.tsx`
- Modify: `home-bakery-management-system/src/App.tsx`

**Interfaces:**
- Consumes: `tokenStore` (Task 6), `api.ts` helpers (Task 7).
- Produces: `AuthProvider`, `useAuth()` → `{ status, email, minting, error, signIn(), signOut() }`. Renders `<LoginScreen />` when unauthenticated.

- [ ] **Step 1: Create `src/context/AuthContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getDeviceToken, setDeviceToken, clearDeviceToken } from "../utils/tokenStore";
import { apiFetch, mintDeviceTokenApi, setUnauthorizedHandler, signOutCurrentDeviceApi } from "../utils/api";

type Status = "checking" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: Status;
  email: string | null;
  minting: boolean;
  error: string | null;
  signIn: () => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unauthenticated = () => {
    setStatus("unauthenticated");
    setEmail(null);
  };
  // A 401 anywhere in the app clears the token and returns to the login screen.
  useEffect(() => setUnauthorizedHandler(unauthenticated), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const isMint = params.get("mint") === "1";

      try {
        // ?mint=1 — we just completed an Access OTP on /admin and carry its cookie.
        if (isMint) {
          setMinting(true);
          const { token } = await mintDeviceTokenApi();
          await setDeviceToken(token);
          if (cancelled) return;
          const url = new URL(window.location.href);
          url.searchParams.delete("mint");
          const clean = url.pathname + url.search;
          if (window.location.pathname !== "/app/") {
            window.location.replace("/app/");
            return;
          }
          window.history.replaceState({}, "", clean);
          setStatus("authenticated");
          return;
        }

        const token = await getDeviceToken();
        if (token) {
          const verify = await apiFetch<{ email: string }>("/api/auth/verify");
          if (cancelled) return;
          setStatus("authenticated");
          setEmail(verify.email);
          return;
        }

        // No token: try a silent mint in case a session cookie already exists
        // (desktop, or a phone that just signed in elsewhere).
        try {
          const { token } = await mintDeviceTokenApi();
          await setDeviceToken(token);
          if (cancelled) return;
          setStatus("authenticated");
        } catch {
          if (cancelled) return;
          unauthenticated();
        }
      } catch {
        if (cancelled) return;
        setError(isMint ? "Sign-in failed. Please try again." : null);
        setMinting(false);
        unauthenticated();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = () => {
    window.location.href = "/admin/?mint=1";
  };

  const signOut = async () => {
    try {
      await signOutCurrentDeviceApi();
    } catch {
      /* token may already be invalid */
    }
    await clearDeviceToken();
    unauthenticated();
  };

  return (
    <AuthContext.Provider value={{ status, email, minting, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

- [ ] **Step 2: Create `src/components/LoginScreen.tsx`**

```tsx
import { useAuth } from "../context/AuthContext";

export default function LoginScreen() {
  const { signIn, minting, error } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-sand-50 px-6">
      <div className="w-full max-w-sm text-center">
        <img
          src="/muy_rico_logo_transparent.webp"
          alt="Muy Rico"
          className="mx-auto h-24 w-auto"
        />
        <h1 className="mt-6 text-2xl font-semibold text-cocoa">Muy Rico Dashboard</h1>
        <p className="mt-2 text-sm text-cocoa/70">
          Sign in to manage orders, products, and inventory.
        </p>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        <button
          onClick={signIn}
          disabled={minting}
          className="mt-6 w-full rounded-lg px-4 py-3 font-medium text-white disabled:opacity-60"
          style={{ backgroundColor: "#1E4636" }}
        >
          {minting ? "Signing in…" : "Sign in with email PIN"}
        </button>
        <p className="mt-4 text-xs text-cocoa/50">
          You'll receive a one-time PIN by email, then stay signed in on this device.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the provider and gate into `App.tsx`** — import `AuthProvider`/`useAuth`/`LoginScreen`, wrap the router, and gate `AdminApp`

```tsx
function AdminApp() {
  const { status } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");
  // …existing state…

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-sand-50">
        <div className="animate-pulse text-cocoa/60">Loading…</div>
      </div>
    );
  }
  if (status === "unauthenticated") return <LoginScreen />;

  // …existing render…
}

export default function App() {
  return (
    <AuthProvider>
      <StoreProvider>
        <AppRouter />
      </StoreProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Typecheck and run existing tests**

Run: `cd home-bakery-management-system && npx tsc --noEmit && npx vitest run`
Expected: no type errors; existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/context/AuthContext.tsx home-bakery-management-system/src/components/LoginScreen.tsx home-bakery-management-system/src/App.tsx
git commit -m "feat(spa): auth gate, login screen, and ?mint=1 handshake"
```

---

## Task 9: Trusted Devices panel in Settings

**Files:**
- Modify: `home-bakery-management-system/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `fetchDevices`, `revokeDeviceApi`, `useAuth().signOut` (Tasks 7-8).
- Produces: a "Trusted devices" section listing each device with label, last-used, expiry, per-row Revoke, and a "Sign out of all devices" action.

- [ ] **Step 1: Add state + data load** inside `Settings()`

```tsx
const { signOut } = useAuth();
const [devices, setDevices] = useState<DeviceInfo[]>([]);
const [devicesLoading, setDevicesLoading] = useState(false);
const [revokingId, setRevokingId] = useState<number | null>(null);

useEffect(() => {
  let cancelled = false;
  setDevicesLoading(true);
  fetchDevices()
    .then((rows) => { if (!cancelled) setDevices(rows); })
    .catch(() => { if (!cancelled) setDevices([]); })
    .finally(() => { if (!cancelled) setDevicesLoading(false); });
  return () => { cancelled = true; };
}, []);

async function revokeDeviceRow(id: number) {
  setRevokingId(id);
  try {
    await revokeDeviceApi(id);
    setDevices((rows) => rows.filter((d) => d.id !== id));
  } catch {
    /* keep list as-is */
  } finally {
    setRevokingId(null);
  }
}
```
Add imports: `import { useAuth } from "../context/AuthContext";`, `import { fetchDevices, revokeDeviceApi, signOutCurrentDeviceApi, type DeviceInfo } from "../utils/api";`.

- [ ] **Step 2: Render the section** (place it below the existing profile/save area, before the danger zone)

```tsx
<section className="mt-8 rounded-lg border border-cocoa/15 bg-white p-6">
  <h2 className="text-lg font-semibold text-cocoa">Trusted devices</h2>
  <p className="mt-1 text-sm text-cocoa/60">
    Devices that stay signed in to the dashboard (e.g. your home-screen app). Revoke any
    device to require a fresh sign-in.
  </p>
  {devicesLoading ? (
    <p className="mt-4 text-sm text-cocoa/50">Loading…</p>
  ) : devices.length === 0 ? (
    <p className="mt-4 text-sm text-cocoa/50">No trusted devices.</p>
  ) : (
    <ul className="mt-4 divide-y divide-cocoa/10">
      {devices.map((d) => (
        <li key={d.id} className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium text-cocoa">{d.label || "Device"}</p>
            <p className="text-xs text-cocoa/50">
              Last used {new Date(d.last_used_at).toLocaleDateString()} ·
              expires {new Date(d.expires_at).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={() => revokeDeviceRow(d.id)}
            disabled={revokingId === d.id}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 disabled:opacity-50"
          >
            Revoke
          </button>
        </li>
      ))}
    </ul>
  )}
  <button
    onClick={signOut}
    className="mt-4 rounded-md border border-cocoa/30 px-3 py-1.5 text-sm text-cocoa"
  >
    Sign out of all devices
  </button>
</section>
```

- [ ] **Step 3: Typecheck**

Run: `cd home-bakery-management-system && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add home-bakery-management-system/src/pages/Settings.tsx
git commit -m "feat(settings): trusted devices management"
```

---

## Task 10: Topbar sign-out (optional, small)

**Files:**
- Modify: `home-bakery-management-system/src/components/Topbar.tsx`

**Interfaces:**
- Consumes: `useAuth().signOut`.

- [ ] **Step 1: Add a Sign out button** to the Topbar actions (next to the existing menu/calendar buttons)

```tsx
const { signOut } = useAuth();
// …
<button
  onClick={signOut}
  className="rounded-md border border-cocoa/30 px-3 py-1.5 text-sm text-cocoa"
  aria-label="Sign out"
>
  Sign out
</button>
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add home-bakery-management-system/src/components/Topbar.tsx
git commit -m "feat(topbar): sign out action"
```

---

## Task 11: Build + deploy + manual verification

**Files:** none (operational).

- [ ] **Step 1: Run the remote migration**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0046_device_tokens.sql
```
Expected: `device_tokens` created on remote D1.

- [ ] **Step 2: Build the SPA**

```bash
cd home-bakery-management-system && npm run build
```
Expected: `dist/index.html` written and copied to `admin/index.html` by `postbuild.sh`.

- [ ] **Step 3: Deploy the API worker**

```bash
npx wrangler deploy -c orders/wrangler.toml
```

- [ ] **Step 4: Deploy the static assets worker** (per README)

```bash
npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21
npx wrangler versions deploy --name muyrico <VERSION_ID>@100%
```

- [ ] **Step 5: Cloudflare dashboard config (manual)** — extend the Cloudflare Access session duration for the `/admin*` application (e.g. to 24h+ / "remember me") so the bootstrap OTP is rare, and confirm `/app*` is **not** covered by the policy.

- [ ] **Step 6: Manual iPhone setup (the owner)** — open `https://muy-rico.com/app/`, tap **Sign in with email PIN**, complete the OTP, then Safari → Share → **Add to Home Screen**. Launch from the icon: the dashboard should appear instantly with no OTP.

- [ ] **Step 7: Manual regression checks** — `/admin/` desktop flow still works (OTP → dashboard); Settings → Trusted devices shows the iPhone; Revoking it forces re-login on the next app launch.

---

## Self-review

**Spec coverage:** PWA shell (Task 1), `/app/` route (Task 2), token table (Task 3), token library (Task 4), API auth gate + endpoints (Task 5), token store (Task 6), Bearer + 401 (Task 7), auth gate/login/mint (Task 8), trusted devices UI (Task 9), sign-out (Task 10), build/deploy/verify (Task 11). All spec sections accounted for.

**Placeholders:** none — every step shows the exact code or command.

**Type consistency:** `mintDeviceToken(env, email, label)` returns `{token, expiresAt}` in both worker and client (`mintDeviceTokenApi`); `resolveDeviceToken` returns `{id, email, expiresAt}`; `DeviceInfo` fields (`id`, `label`, `created_at`, `last_used_at`, `expires_at`) match `listDevices` SELECT columns and the SPA interface. Client helper names (`fetchDevices`, `revokeDeviceApi`, `signOutCurrentDeviceApi`, `mintDeviceTokenApi`) match Task 8/9 usage. Auth context exposes `{status, email, minting, error, signIn, signOut}`.
