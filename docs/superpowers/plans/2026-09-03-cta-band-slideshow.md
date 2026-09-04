# CTA Band Slideshow (Dashboard-Managed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a dashboard-managed photo slideshow (R2 images + EN/ES title/description) that powers the homepage CTA band, with a static concha photo fallback when no slides exist.

**Architecture:** New D1 table `slideshow_slides` + CRUD routes in the existing orders Worker (mirroring the gallery pattern), a new "Slideshow" page in the React dashboard, and a progressive-enhancement slideshow in `index.html`'s CTA band (CSS opacity crossfade + vanilla JS, no new dependencies). Public band fetches `GET /api/slideshow` once after first paint; empty/error = today's static photo.

**Tech Stack:** Cloudflare Workers + D1, React 19 + Vite + Tailwind 4 (dashboard), vanilla HTML/CSS/JS (marketing site), Playwright (@playwright/test, already a devDependency), wrangler for local dev.

**Spec:** `docs/superpowers/specs/2026-09-03-cta-band-slideshow-design.md`

## Global Constraints

- No new npm dependencies anywhere.
- Em-dashes (`—`, `–`) are banned in all new visible copy (headings, labels, captions).
- Bilingual: every owner-facing text field is EN + optional ES; dashboard labels in English (dashboard has no ES mode).
- ID prefix for new rows: `sld_`.
- Client-side slide cap: 8.
- Autoplay: 5000ms interval; crossfade: 800ms CSS opacity transition; caption fade: 300ms.
- Never break: existing CTA hrefs/labels, `applyLangToDOM` mechanics, GSAP `.no-gsap` fallbacks, reduced-motion behavior.
- Do NOT touch: `orders/workers/api.js` quote-deposit work in progress (uncommitted changes by others), `gallery`, `testimonials`, `motion.js`.
- Local dev API base: the marketing site already uses `http://localhost:8787` when hostname is localhost (`ORDER_API` in index.html) — keep that.
- ENVIRONMENT (from prior SDD runs): repo wrangler 4.100.0 `dev` HANGS. Use `npx -y wrangler@4.127.0` for ALL local D1 operations (`d1 execute --local`) and `wrangler dev` (port 8794, run from `orders/` with `--config wrangler.toml`; the root `wrangler.jsonc` interferes with config discovery). Never mix wrangler versions against the same local D1 state in one session. Remote `deploy` / `d1 execute --remote` via repo-local wrangler are fine.

---

### Task 1: D1 migration `0045_slideshow.sql`

**Files:**
- Create: `orders/migrations/0045_slideshow.sql`

**Interfaces:**
- Produces: table `slideshow_slides` with columns `id TEXT PK, title TEXT NOT NULL, title_es TEXT, description TEXT, description_es TEXT, image_url TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0, created_at TEXT, updated_at TEXT`. Later tasks rely on these exact column names.

- [ ] **Step 1: Write the migration file**

Create `orders/migrations/0045_slideshow.sql` with exactly:

```sql
-- Muy Rico — Homepage CTA band slideshow (owner-managed, independent of products)
-- Run:
--   npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0045_slideshow.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0045_slideshow.sql

CREATE TABLE IF NOT EXISTS slideshow_slides (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  title_es      TEXT,
  description   TEXT,
  description_es TEXT,
  image_url     TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_slideshow_active ON slideshow_slides(active);
CREATE INDEX IF NOT EXISTS idx_slideshow_order  ON slideshow_slides(display_order);
```

- [ ] **Step 2: Apply locally**

Run:
```bash
npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --file=orders/migrations/0045_slideshow.sql
```
Expected: `Executed 3 queries in ...` (table + 2 indexes), no errors.

- [ ] **Step 3: Verify the table exists**

Run:
```bash
npx -y wrangler@4.127.0 d1 execute muy-rico-orders --config orders/wrangler.toml --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name='slideshow_slides'"
```
Expected: one result row with `slideshow_slides`.

- [ ] **Step 4: Commit**

```bash
git add orders/migrations/0045_slideshow.sql
git commit -m "feat: add slideshow_slides table migration"
```

---

### Task 2: Workers API — slideshow routes + handlers

**Files:**
- Modify: `orders/workers/api.js` (3 locations: public-route flag ~line 97, route guards ~line 210, handlers after the gallery block ~line 1591)

**Interfaces:**
- Consumes: `slideshow_slides` table (Task 1), existing helpers `json(data, status)`, actor auth guard block.
- Produces (consumed by Tasks 3, 4, 6):
  - `GET /api/slideshow` → `200 { slides: [{ id, title, title_es, description, description_es, image_url, active, display_order }] }` (public, `active = 1`, ordered `display_order ASC, created_at ASC`; booleans as JSON booleans, numbers as numbers)
  - `GET /api/slideshow/all` → same shape, all rows (admin)
  - `POST /api/slideshow` body `{ title, image_url, title_es?, description?, description_es?, display_order?, active?, id? }` → `201 { ok, id }` (400 if `title` or `image_url` missing)
  - `PATCH /api/slideshow/:id` partial of the above → `200 { ok }` / `404`
  - `DELETE /api/slideshow/:id` → `200 { ok }` / `404`

- [ ] **Step 1: Add the public-route flag**

In `orders/workers/api.js`, find the flag block (search `isPublicGalleryGet = path === '/api/gallery'`). Immediately after that line, add:

```js
    // Public read-only homepage slideshow slides
    const isPublicSlideshowGet = path === '/api/slideshow' && method === 'GET';
```

Then find the single 401 guard (search `Unauthorized — Cloudflare Access required`). Add `&& !isPublicSlideshowGet` into the condition chain right after `!isPublicGalleryGet`:

```js
    if (!actorEmail && !isLocal && !isPublicPost && !isPublicProductGet && !isPublicGalleryGet && !isPublicSlideshowGet && !isPublicSiteGet && !isPublicMarkPaid && !isPublicPayable && !isPublicPaymentStatus && !isPublicQuotePost && !isPublicQuoteUpload && !isPublicPaymentOptions && !isPublicQuoteDepositGet && !isPublicQuoteDepositPaid) {
```

- [ ] **Step 2: Add route guards**

Find the gallery route block (search `if (path === '/api/gallery' && method === 'GET')`). Immediately after that gallery block's closing `}` (after the `if (gm) { ... }` group), add:

```js
      if (path === '/api/slideshow' && method === 'GET') return await listSlideshow(env);
      if (path === '/api/slideshow/all' && method === 'GET') return await listSlideshowAdmin(env);
      if (path === '/api/slideshow' && method === 'POST') return await createSlideshowSlide(request, env, actorName);

      const sm = path.match(/^\/api\/slideshow\/([A-Za-z0-9_-]+)$/);
      if (sm) {
        const id = sm[1];
        if (method === 'PATCH')  return await updateSlideshowSlide(id, request, env, actorName);
        if (method === 'DELETE') return await deleteSlideshowSlide(id, env);
      }
```

- [ ] **Step 3: Add handlers**

Immediately after the `deleteGalleryPhoto` function (search `async function deleteGalleryPhoto`), add this complete block:

```js
// ─── Homepage slideshow (owner-managed, independent of products) ──────────

const SLIDESHOW_FIELDS = [
  'title', 'title_es', 'description', 'description_es', 'image_url', 'active', 'display_order',
];

function mapSlideshowRow(r) {
  return {
    id: r.id,
    title: r.title,
    title_es: r.title_es,
    description: r.description,
    description_es: r.description_es,
    image_url: r.image_url,
    active: Boolean(r.active),
    display_order: Number(r.display_order) || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

async function listSlideshow(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM slideshow_slides
    WHERE active = 1
    ORDER BY display_order ASC, created_at ASC
  `).all();
  return json({ slides: (results || []).map(mapSlideshowRow) }, 200);
}

async function listSlideshowAdmin(env) {
  const { results } = await env.DB.prepare(`
    SELECT * FROM slideshow_slides
    ORDER BY display_order ASC, created_at ASC
  `).all();
  return json({ slides: (results || []).map(mapSlideshowRow) }, 200);
}

async function createSlideshowSlide(request, env, actor) {
  const body = await request.json();
  if (!body.title || !body.image_url) {
    return json({ error: 'Missing required fields: title, image_url' }, 400);
  }
  const id = body.id || `sld_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    await env.DB.prepare(`
      INSERT INTO slideshow_slides (id, title, title_es, description, description_es, image_url, active, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      body.title,
      body.title_es || null,
      body.description || null,
      body.description_es || null,
      body.image_url,
      body.active === false ? 0 : 1,
      Number(body.display_order) || 0,
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id }, 201);
}

async function updateSlideshowSlide(id, request, env, actor) {
  const body = await request.json();
  const sets = [];
  const binds = [];
  for (const f of SLIDESHOW_FIELDS) {
    if (body[f] === undefined) continue;
    let val = body[f];
    if (f === 'active') val = val ? 1 : 0;
    if (f === 'display_order') val = Number(val) || 0;
    sets.push(`${f} = ?`);
    binds.push(val);
  }
  if (!sets.length) return json({ error: 'Nothing to update' }, 400);
  sets.push("updated_at = datetime('now')");
  binds.push(id);
  const r = await env.DB.prepare(`UPDATE slideshow_slides SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteSlideshowSlide(id, env) {
  const r = await env.DB.prepare(
    `DELETE FROM slideshow_slides WHERE id = ?`
  ).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}
```

- [ ] **Step 4: Syntax check**

Run: `node --check orders/workers/api.js`
Expected: no output (clean parse).

- [ ] **Step 5: Verify with local Worker + curl**

Start the local worker (background):
```bash
npx -y wrangler@4.127.0 dev --config wrangler.toml --port 8794   # run from orders/
```
Then in another shell (local dev bypasses Cloudflare Access via `isLocal`):

```bash
# 1. Empty list
curl -s http://localhost:8794/api/slideshow
# Expected: {"slides":[]}

# 2. Create (requires title + image_url)
curl -s -X POST http://localhost:8794/api/slideshow -H 'Content-Type: application/json' \
  -d '{"title":"Conchas","title_es":"Conchas","description":"Vanilla and chocolate","description_es":"Vainilla y chocolate","image_url":"https://example.com/a.webp"}'
# Expected: {"ok":true,"id":"sld_..."}

# 3. Create second, then verify ordering + public filter
curl -s -X POST http://localhost:8794/api/slideshow -H 'Content-Type: application/json' \
  -d '{"title":"Bolillos","image_url":"https://example.com/b.webp","display_order":1}'
curl -s http://localhost:8794/api/slideshow | python3 -m json.tool
# Expected: slides in display_order (Conchas first), both active

# 4. Validation: missing title
curl -s -X POST http://localhost:8794/api/slideshow -H 'Content-Type: application/json' -d '{"image_url":"x"}'
# Expected: {"error":"Missing required fields: title, image_url"} with status 400

# 5. Patch (toggle inactive)
ID=$(curl -s http://localhost:8794/api/slideshow/all | python3 -c "import sys,json;print(json.load(sys.stdin)['slides'][0]['id'])")
curl -s -X PATCH http://localhost:8794/api/slideshow/$ID -H 'Content-Type: application/json' -d '{"active":false}'
curl -s http://localhost:8794/api/slideshow
# Expected: {"ok":true} then the public list no longer contains that slide

# 6. Delete
curl -s -X DELETE http://localhost:8794/api/slideshow/$ID
# Expected: {"ok":true}
```

Stop the worker when done (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat: slideshow slides CRUD API (public GET + admin CRUD)"
```

---

### Task 3: Dashboard API client (`api.ts`)

**Files:**
- Modify: `home-bakery-management-system/src/utils/api.ts` (insert after the gallery section, which ends with `deleteGalleryPhoto` around line 306, before the `// ─── Inventory` section)

**Interfaces:**
- Consumes: `apiFetch` helper and `uploadImage` (both already in api.ts), Worker routes from Task 2.
- Produces (consumed by Task 4):

```ts
export interface ApiSlideshowSlide {
  id: string;
  title: string;
  title_es?: string | null;
  description?: string | null;
  description_es?: string | null;
  image_url: string;
  active: boolean;
  display_order: number;
}
export interface SlideshowSlideCreate {
  title: string;
  title_es?: string | null;
  description?: string | null;
  description_es?: string | null;
  image_url: string;
  display_order?: number;
  active?: boolean;
}
export type SlideshowSlideUpdate = Partial<SlideshowSlideCreate>;
export async function fetchSlideshowAdmin(): Promise<ApiSlideshowSlide[]>
export async function createSlideshowSlide(p: SlideshowSlideCreate): Promise<{ ok: boolean; id: string }>
export async function updateSlideshowSlide(id: string, patch: SlideshowSlideUpdate): Promise<{ ok: boolean }>
export async function deleteSlideshowSlide(id: string): Promise<{ ok: boolean }>
```

- [ ] **Step 1: Add types and client functions**

In `src/utils/api.ts`, directly after the `deleteGalleryPhoto` function (and before the `// ─── Inventory` comment banner), insert:

```ts
// ─── Homepage slideshow ────────────────────────────────────────────────────

export interface ApiSlideshowSlide {
  id: string;
  title: string;
  title_es?: string | null;
  description?: string | null;
  description_es?: string | null;
  image_url: string;
  active: boolean;
  display_order: number;
}

export interface SlideshowSlideCreate {
  title: string;
  title_es?: string | null;
  description?: string | null;
  description_es?: string | null;
  image_url: string;
  display_order?: number;
  active?: boolean;
}

export type SlideshowSlideUpdate = Partial<SlideshowSlideCreate>;

export async function fetchSlideshowAdmin(): Promise<ApiSlideshowSlide[]> {
  const data = await apiFetch<{ slides: ApiSlideshowSlide[] }>("/api/slideshow/all");
  return data.slides;
}

export async function createSlideshowSlide(
  p: SlideshowSlideCreate
): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/slideshow", {
    method: "POST",
    body: JSON.stringify(p),
  });
}

export async function updateSlideshowSlide(
  id: string,
  patch: SlideshowSlideUpdate
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/slideshow/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteSlideshowSlide(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/slideshow/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
```

- [ ] **Step 2: Typecheck + build**

Run:
```bash
cd home-bakery-management-system && npm run build
```
Expected: `vite build` completes with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add home-bakery-management-system/src/utils/api.ts
git commit -m "feat: dashboard API client for slideshow slides"
```

---

### Task 4: Dashboard "Slideshow" page + navigation wiring

**Files:**
- Create: `home-bakery-management-system/src/pages/Slideshow.tsx`
- Modify: `home-bakery-management-system/src/components/Sidebar.tsx` (imports line 1-15, NAV array lines 22-36)
- Modify: `home-bakery-management-system/src/App.tsx` (Page union lines 21-34, page switch ~line 131)

**Interfaces:**
- Consumes: Task 3 client functions, `uploadImage`, `Modal` component (`../components/ui/Modal`), `useStore` not needed (no product dependency).
- Produces: dashboard page reachable via sidebar item `slideshow`.

- [ ] **Step 1: Create `Slideshow.tsx`**

Create `home-bakery-management-system/src/pages/Slideshow.tsx` with exactly:

```tsx
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import Modal from "../components/ui/Modal";
import {
  createSlideshowSlide,
  deleteSlideshowSlide,
  fetchSlideshowAdmin,
  updateSlideshowSlide,
  uploadImage,
  type ApiSlideshowSlide,
} from "../utils/api";

type Draft = {
  title: string;
  title_es: string;
  description: string;
  description_es: string;
  image_url: string;
};

const emptyDraft = (): Draft => ({
  title: "",
  title_es: "",
  description: "",
  description_es: "",
  image_url: "",
});

export default function Slideshow() {
  const [slides, setSlides] = useState<ApiSlideshowSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const rows = await fetchSlideshowAdmin();
      setSlides(rows);
    } catch (e: any) {
      setError(e?.message || "Failed to load slideshow");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ordered = sortSlides(slides);

  function openNew() {
    setEditingId(null);
    setDraft(emptyDraft());
    setModalOpen(true);
  }

  function openEdit(s: ApiSlideshowSlide) {
    setEditingId(s.id);
    setDraft({
      title: s.title,
      title_es: s.title_es || "",
      description: s.description || "",
      description_es: s.description_es || "",
      image_url: s.image_url,
    });
    setModalOpen(true);
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await uploadImage(file);
      setDraft((d) => ({ ...d, image_url: url }));
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!draft.title.trim() || !draft.image_url) {
      setError("Title and image are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateSlideshowSlide(editingId, {
          title: draft.title.trim(),
          title_es: draft.title_es.trim() || null,
          description: draft.description.trim() || null,
          description_es: draft.description_es.trim() || null,
          image_url: draft.image_url,
        });
      } else {
        const nextOrder =
          slides.length === 0
            ? 0
            : Math.max(...slides.map((s) => s.display_order || 0)) + 1;
        await createSlideshowSlide({
          title: draft.title.trim(),
          title_es: draft.title_es.trim() || null,
          description: draft.description.trim() || null,
          description_es: draft.description_es.trim() || null,
          image_url: draft.image_url,
          display_order: nextOrder,
          active: true,
        });
      }
      setModalOpen(false);
      setEditingId(null);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(s: ApiSlideshowSlide) {
    try {
      await updateSlideshowSlide(s.id, { active: !s.active });
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to update slide");
    }
  }

  async function remove(s: ApiSlideshowSlide) {
    if (!confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
    try {
      await deleteSlideshowSlide(s.id);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to delete slide");
    }
  }

  async function move(s: ApiSlideshowSlide, dir: -1 | 1) {
    const idx = ordered.findIndex((x) => x.id === s.id);
    const swap = ordered[idx + dir];
    if (!swap) return;
    try {
      await Promise.all([
        updateSlideshowSlide(s.id, { display_order: swap.display_order }),
        updateSlideshowSlide(swap.id, { display_order: s.display_order }),
      ]);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Failed to reorder slide");
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-cocoa">Slideshow</h1>
          <p className="text-sm text-cocoa/60">
            Photos for the homepage carousel. Landscape shots around 3:2 look best. First 8 active slides are shown.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
        >
          <Plus size={16} /> Add slide
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cocoa/50">Loading slideshow…</p>
      ) : ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cocoa/20 bg-white p-10 text-center text-sm text-cocoa/60">
          No slides yet. The homepage band shows a static photo until you add one.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((s, i) => (
            <article
              key={s.id}
              className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                s.active ? "border-cocoa/10" : "border-cocoa/5 opacity-70"
              }`}
            >
              <div className="aspect-[3/2] overflow-hidden bg-sand-100">
                <img
                  src={s.image_url}
                  alt={s.title}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="space-y-2 p-3">
                <p className="truncate font-medium text-cocoa">{s.title}</p>
                {s.title_es && (
                  <p className="truncate text-xs text-cocoa/50">{s.title_es}</p>
                )}
                {s.description && (
                  <p className="line-clamp-2 text-xs text-cocoa/60">{s.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    title="Edit"
                    onClick={() => openEdit(s)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    title="Move up"
                    disabled={i === 0}
                    onClick={() => move(s, -1)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100 disabled:opacity-30"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    disabled={i === ordered.length - 1}
                    onClick={() => move(s, 1)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100 disabled:opacity-30"
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    title={s.active ? "Hide" : "Show"}
                    onClick={() => toggleActive(s)}
                    className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100"
                  >
                    {s.active ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button
                    type="button"
                    title="Delete"
                    onClick={() => remove(s)}
                    className="ml-auto rounded-lg p-1.5 text-red-600/80 hover:bg-red-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setEditingId(null); }} title={editingId ? "Edit slide" : "Add slide"}>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Title (English)</span>
            <input
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Title (Spanish)</span>
            <input
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              value={draft.title_es}
              onChange={(e) => setDraft({ ...draft, title_es: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Description (English)</span>
            <textarea
              rows={2}
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Description (Spanish)</span>
            <textarea
              rows={2}
              className="w-full rounded-xl border border-cocoa/15 px-3 py-2"
              value={draft.description_es}
              onChange={(e) => setDraft({ ...draft, description_es: e.target.value })}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Photo</span>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onFile(e.target.files?.[0] || null)}
              className="block w-full text-sm"
            />
          </label>
          {uploading && <p className="text-xs text-cocoa/50">Uploading…</p>}
          {draft.image_url && (
            <img
              src={draft.image_url}
              alt="Preview"
              className="h-40 w-full rounded-xl object-cover"
            />
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { setModalOpen(false); setEditingId(null); }}
              className="rounded-full px-4 py-2 text-sm text-cocoa/70 hover:bg-sand-100"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || uploading}
              onClick={save}
              className="rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Update slide" : "Save slide"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function sortSlides(slides: ApiSlideshowSlide[]): ApiSlideshowSlide[] {
  return [...slides].sort(
    (a, b) => (a.display_order - b.display_order) || a.id.localeCompare(b.id)
  );
}
```

- [ ] **Step 2: Wire the sidebar**

In `src/components/Sidebar.tsx`:

1. Add `GalleryHorizontal` to the lucide-react import (alphabetical list, after `Cookie`):

```tsx
import {
  LayoutDashboard,
  ClipboardList,
  CalendarDays,
  Cookie,
  GalleryHorizontal,
  Images,
  Home,
  Package,
  Users,
  Wallet,
  Mail,
  Tag,
  Settings,
  MessageSquareQuote,
} from "lucide-react";
```

2. Add the NAV entry after `gallery` (before `homepage`):

```tsx
  { id: "slideshow", label: "Slideshow", icon: GalleryHorizontal },
```

- [ ] **Step 3: Wire the page union + switch**

In `src/App.tsx`, extend the `Page` union (add after `| "gallery"`):

```tsx
  | "slideshow"
```

In the page switch, add after the gallery line (`{page === "gallery" && <Gallery />}`):

```tsx
          {page === "slideshow" && <Slideshow />}
```

And add the import at the top of `App.tsx` alongside the other page imports (match the existing import style for pages):

```tsx
import Slideshow from "./pages/Slideshow";
```

- [ ] **Step 4: Typecheck + build**

Run:
```bash
cd home-bakery-management-system && npm run build
```
Expected: build succeeds, no TypeScript errors. (A `function` declaration hoists, so calling `sortSlides` above its definition is safe.)

- [ ] **Step 5: Manual smoke test against local worker**

With the Task 2 worker still pattern in mind (restart `npx -y wrangler@4.127.0 dev --config wrangler.toml --port 8794   # run from orders/` if stopped):

Run:
```bash
cd home-bakery-management-system && npm run dev
```
Open the printed local URL, click "Slideshow" in the sidebar. Verify: empty state message shows; Add slide modal opens; (create one via the form if the worker is running, verify it lists with preview, eye-toggle, reorder arrows). Close dev servers when done.

- [ ] **Step 6: Commit**

```bash
git add home-bakery-management-system/src/pages/Slideshow.tsx home-bakery-management-system/src/components/Sidebar.tsx home-bakery-management-system/src/App.tsx
git commit -m "feat: dashboard Slideshow page with sidebar navigation"
```

---

### Task 5: Homepage band CSS + markup containers

**Files:**
- Modify: `style.css` (CTA band block, after `.cta-band-photo-caption` rules ~line 1014)
- Modify: `index.html` (figure markup lines 415-422)

**Interfaces:**
- Consumes: existing `.frame`, `.ratio-3-2`, `.cta-band-photo` styles.
- Produces (consumed by Task 6 JS): classes `.slide-well`, `.cta-slide`, `.cta-slide.is-active`, `.cta-band-dots`, `.cta-dot`, `.cta-dot.is-active`, `.cta-slide-title`, `.cta-slide-desc`, and the DOM ids `cta-band-frame`, `cta-band-dots`, `cta-band-caption`.

- [ ] **Step 1: Add slideshow CSS**

In `style.css`, immediately after the existing `.cta-band-photo-caption { ... }` rule, add:

```css
/* CTA band slideshow (progressive enhancement over the static photo) */
.cta-band-slides .slide-well {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: calc(var(--r-widget) - 8px);
  overflow: hidden;
}
.cta-slide {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.8s ease;
}
.cta-slide.is-active { opacity: 1; }
.cta-band-dots {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  padding: 0.85rem 0 0;
}
.cta-dot {
  width: 9px;
  height: 9px;
  padding: 0;
  border-radius: 50%;
  background: rgba(250, 246, 236, 0.35);
  transition: background 0.25s ease, transform 0.25s ease;
}
.cta-dot:hover { background: rgba(250, 246, 236, 0.6); }
.cta-dot.is-active { background: var(--cream); transform: scale(1.25); }
.cta-slide-title {
  display: block;
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.92rem;
  line-height: 1.4;
}
.cta-slide-desc {
  display: block;
  font-family: var(--font-sans);
  font-style: normal;
  font-size: 0.78rem;
  color: rgba(250, 246, 236, 0.55);
  line-height: 1.5;
  margin-top: 0.15rem;
}
```

Note: `.cta-slide-title` inherits the caption's serif-italic look because `.cta-band-photo-caption` already sets `font-family: var(--font-serif)`, `font-style: italic`, `color: rgba(250, 246, 236, 0.66)`; the explicit declarations above make the spans safe if markup changes later.

- [ ] **Step 2: Add ids/containers to the figure markup**

In `index.html`, replace the current figure (lines 415-422):

```html
        <figure class="cta-band-photo" data-motion="scale">
          <div class="frame ratio-3-2">
            <img class="frame-img" src="hero-conchas.webp" alt="Conchas recién horneadas en una rejilla" loading="lazy" width="1360" height="1600"/>
          </div>
          <figcaption class="cta-band-photo-caption lang-fade"
                      data-es="Conchas, horneadas esta mañana"
                      data-en="Conchas, baked this morning">Conchas, baked this morning</figcaption>
        </figure>
```

with:

```html
        <figure class="cta-band-photo" data-motion="scale">
          <div class="frame ratio-3-2" id="cta-band-frame">
            <img class="frame-img" id="cta-band-static-img" src="hero-conchas.webp" alt="Conchas recién horneadas en una rejilla" loading="lazy" width="1360" height="1600"/>
          </div>
          <figcaption class="cta-band-photo-caption lang-fade" id="cta-band-caption"
                      data-es="Conchas, horneadas esta mañana"
                      data-en="Conchas, baked this morning">Conchas, baked this morning</figcaption>
        </figure>
```

(Ids only; no visual change. Dots container is injected by JS between frame and caption only when slides exist.)

- [ ] **Step 3: Verify nothing regressed**

Run the existing checks manually if the local server is running (`python3 -m http.server 8901`):
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8901/index.html
```
Expected: 200. Open http://localhost:8901/index.html, scroll to the band: identical to before (static photo, caption).

- [ ] **Step 4: Commit**

```bash
git add style.css index.html
git commit -m "feat: cta band slideshow css + markup containers"
```

---

### Task 6: Slideshow JS (crossfade, dots, hydration)

**Files:**
- Modify: `index.html` (inline script: `setLang` hook + new slideshow block inserted before the `/* ---------------- Init ---------------- */` section, and two init calls added next to `loadSite();` / `loadFeatured();`)

**Interfaces:**
- Consumes: Task 2 `GET /api/slideshow` (`{ slides }`), Task 5 DOM ids/classes, existing inline-script globals `ORDER_API`, `currentLang`, `prefersReduced`, `escapeHtml`.
- Produces: working band slideshow; global function `renderCtaCaption()` callable from `setLang`.

- [ ] **Step 1: Hook caption re-render into `setLang`**

Find `function setLang(lang) {` in the inline script. Inside it, after `applyLangToDOM(lang);`, add one line so the whole function reads:

```js
    function setLang(lang) {
      if (lang === currentLang) return;
      currentLang = lang;
      try { localStorage.setItem('lang', lang); } catch (e) {}
      applyLangToDOM(lang);
      renderCtaCaption();
    }
```

(`renderCtaCaption` is declared later in the same script as a `function` declaration, so hoisting makes it safe.)

- [ ] **Step 2: Add the slideshow block**

Insert this complete block immediately BEFORE the `/* ---------------- Init ---------------- */` comment:

```js
    /* ---------------- CTA band slideshow ---------------- */
    const CTA_SLIDE_MS = 5000;
    const CTA_MAX_SLIDES = 8;
    let ctaSlides = [];
    let ctaIndex = 0;
    let ctaTimer = null;
    let ctaHover = false;
    let ctaFocus = false;
    let ctaStaticBackup = null;

    function ctaCaptionHtml(slide) {
      const es = currentLang === 'es';
      const title = (es && slide.title_es) || slide.title || '';
      const desc = (es && slide.description_es) || slide.description || '';
      let html = `<span class="cta-slide-title">${escapeHtml(title)}</span>`;
      if (desc) html += `<span class="cta-slide-desc">${escapeHtml(desc)}</span>`;
      return html;
    }

    function renderCtaCaption() {
      const cap = document.getElementById('cta-band-caption');
      if (!cap || !ctaSlides.length) return;
      cap.innerHTML = ctaCaptionHtml(ctaSlides[ctaIndex] || ctaSlides[0]);
    }

    function ctaGoTo(i, manual) {
      if (!ctaSlides.length) return;
      i = ((i % ctaSlides.length) + ctaSlides.length) % ctaSlides.length;
      if (i === ctaIndex) { if (manual) restartCtaTimer(); return; }
      const imgs = document.querySelectorAll('.cta-band-photo .cta-slide');
      const dots = document.querySelectorAll('#cta-band-dots .cta-dot');
      if (imgs[ctaIndex]) imgs[ctaIndex].classList.remove('is-active');
      if (dots[ctaIndex]) {
        dots[ctaIndex].classList.remove('is-active');
        dots[ctaIndex].removeAttribute('aria-current');
      }
      ctaIndex = i;
      if (imgs[ctaIndex]) imgs[ctaIndex].classList.add('is-active');
      if (dots[ctaIndex]) {
        dots[ctaIndex].classList.add('is-active');
        dots[ctaIndex].setAttribute('aria-current', 'true');
      }
      const cap = document.getElementById('cta-band-caption');
      if (cap && !prefersReduced) {
        cap.classList.add('is-fading');
        setTimeout(() => { renderCtaCaption(); cap.classList.remove('is-fading'); }, 300);
      } else if (cap) {
        renderCtaCaption();
      }
      if (manual) restartCtaTimer();
    }

    function ctaTick() {
      if (ctaHover || ctaFocus || document.hidden) return;
      ctaGoTo(ctaIndex + 1, false);
    }

    function restartCtaTimer() {
      if (ctaTimer) clearInterval(ctaTimer);
      ctaTimer = null;
      if (prefersReduced) return;
      ctaTimer = setInterval(ctaTick, CTA_SLIDE_MS);
    }

    function ctaRestoreStatic() {
      if (!ctaStaticBackup) return;
      const frame = document.getElementById('cta-band-frame');
      const cap = document.getElementById('cta-band-caption');
      if (frame) frame.innerHTML = ctaStaticBackup.frameHtml;
      if (cap) {
        cap.innerHTML = ctaStaticBackup.captionHtml;
        cap.setAttribute('data-es', ctaStaticBackup.captionEs);
        cap.setAttribute('data-en', ctaStaticBackup.captionEn);
      }
      const dots = document.getElementById('cta-band-dots');
      if (dots) dots.remove();
      ctaSlides = [];
      ctaIndex = 0;
      ctaStaticBackup = null;
    }

    function buildCtaSlideshow(slides) {
      const frame = document.getElementById('cta-band-frame');
      const cap = document.getElementById('cta-band-caption');
      if (!frame || !cap || !slides.length) return;

      if (!ctaStaticBackup) {
        ctaStaticBackup = {
          frameHtml: frame.innerHTML,
          captionHtml: cap.innerHTML,
          captionEs: cap.getAttribute('data-es') || '',
          captionEn: cap.getAttribute('data-en') || '',
        };
      }

      ctaSlides = slides.slice(0, CTA_MAX_SLIDES);
      ctaIndex = 0;

      frame.innerHTML = '<div class="slide-well">' +
        ctaSlides.map((s, i) =>
          `<img class="cta-slide${i === 0 ? ' is-active' : ''}" src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.title)}" loading="${i === 0 ? 'eager' : 'lazy'}"/>`
        ).join('') +
      '</div>';

      let dots = document.getElementById('cta-band-dots');
      if (!dots) {
        dots = document.createElement('div');
        dots.id = 'cta-band-dots';
        dots.className = 'cta-band-dots';
        dots.setAttribute('role', 'tablist');
        dots.setAttribute('aria-label', 'Choose photo');
        cap.parentNode.insertBefore(dots, cap);
      }
      dots.innerHTML = ctaSlides.map((s, i) =>
        `<button type="button" class="cta-dot${i === 0 ? ' is-active' : ''}" role="tab" aria-label="Slide ${i + 1}: ${escapeHtml(s.title)}"${i === 0 ? ' aria-current="true"' : ''}></button>`
      ).join('');
      Array.from(dots.children).forEach((btn, i) => {
        btn.addEventListener('click', () => ctaGoTo(i, true));
      });

      // Bilingual attrs must go: applyLangToDOM would overwrite dynamic caption text
      cap.removeAttribute('data-es');
      cap.removeAttribute('data-en');
      cap.classList.remove('lang-fade');
      renderCtaCaption();

      // Broken images drop out of the rotation
      frame.querySelectorAll('.cta-slide').forEach((img, i) => {
        img.addEventListener('error', () => {
          ctaSlides.splice(i, 1);
          if (ctaSlides.length === 0) { ctaRestoreStatic(); return; }
          buildCtaSlideshow(ctaSlides);
        });
      });

      const fig = frame.closest('.cta-band-photo');
      if (fig && !fig.dataset.ctaBound) {
        fig.dataset.ctaBound = '1';
        fig.addEventListener('mouseenter', () => { ctaHover = true; });
        fig.addEventListener('mouseleave', () => { ctaHover = false; });
        fig.addEventListener('focusin', () => { ctaFocus = true; });
        fig.addEventListener('focusout', () => { ctaFocus = false; });
      }

      restartCtaTimer();
    }

    async function loadSlideshow() {
      try {
        const res = await fetch((ORDER_API || '') + '/api/slideshow');
        if (!res.ok) return;
        const data = await res.json();
        const slides = (data.slides || []).filter(s => s.image_url);
        if (slides.length) buildCtaSlideshow(slides);
      } catch (e) { /* static default remains */ }
    }
```

- [ ] **Step 3: Add the caption fade CSS hook + init call**

1. In `style.css`, inside the `.cta-band-photo-caption` area (right after the rule added in Task 5), add:

```css
.cta-band-photo-caption.is-fading { opacity: 0; }
```

(The caption already has `transition: opacity 0.25s ease` via `.lang-fade`; after removing `lang-fade` in slideshow mode, add the transition explicitly to the base caption rule. Change the existing `.cta-band-photo-caption` rule's final line to include the transition — full updated rule:)

```css
.cta-band-photo-caption {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 0.92rem;
  color: rgba(250, 246, 236, 0.66);
  padding-top: 0.7rem;
  text-align: center;
  line-height: 1.4;
  transition: opacity 0.3s ease;
}
```

2. In `index.html`, at the very bottom of the inline script, add `loadSlideshow();` next to the existing init calls so it reads:

```js
    loadSite();
    loadFeatured();
    loadSlideshow();
```

- [ ] **Step 4: Verify with local worker + browser**

1. Start the orders worker in the background: `npx -y wrangler@4.127.0 dev --config wrangler.toml --port 8794   # run from orders/`.
2. Insert two test rows (curl POSTs from Task 2 Step 5, with real reachable image URLs — use local paths like `http://localhost:8901/menu-conchas.webp` and `http://localhost:8901/menu-bolillos.webp`, which are same-origin to the site and always resolve).
3. Start the static server if needed: `python3 -m http.server 8901`.
4. Open `http://localhost:8901/index.html`, scroll to the band. Expected:
   - Slideshow active: 2 dots under the frame, crossfade every 5s, caption shows title + description.
   - Hover pauses; dot click jumps; ES toggle swaps caption text to `title_es`/`description_es`.
5. Stop the worker → reload page → band shows static concha photo, no dots (API down fallback).

- [ ] **Step 5: Commit**

```bash
git add index.html style.css
git commit -m "feat: cta band crossfade slideshow with api hydration"
```

---

### Task 7: Playwright regression suite + cleanup

**Files:**
- Create: `playwright.config.ts` (repo root)
- Create: `tests/cta-band.spec.ts` (repo root)
- Delete: `slideshow-sample.html`
- Modify: `README.md` (Pages table row for the dashboard gains Slideshow mention; add the public endpoint bullet)

**Interfaces:**
- Consumes: everything from Tasks 1-6; local orders Worker (wrangler dev, port 8787) and static server (port 8901).
- Produces: `npx playwright test` as the permanent regression gate for the band.

- [ ] **Step 1: Create `playwright.config.ts`**

Create `playwright.config.ts` at the repo root with exactly:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:8901',
  },
  webServer: {
    command: 'python3 -m http.server 8901',
    port: 8901,
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 2: Create `tests/cta-band.spec.ts`**

Create `tests/cta-band.spec.ts` with exactly:

```ts
import { test, expect, type Page } from '@playwright/test';

const WORKER = 'http://localhost:8787';

const MOCK_SLIDES = [
  {
    id: 'sld_test1',
    title: 'Conchas',
    title_es: 'Conchas',
    description: 'Vanilla and chocolate',
    description_es: 'Vainilla y chocolate',
    image_url: '/menu-conchas.webp',
    active: true,
    display_order: 0,
  },
  {
    id: 'sld_test2',
    title: 'Bolillos',
    title_es: 'Bolillos',
    description: 'Crusty rolls',
    description_es: 'Pan crujiente',
    image_url: '/menu-bolillos.webp',
    active: true,
    display_order: 1,
  },
];

async function mockSlideshow(page: Page, slides: unknown[] | 'error') {
  await page.route('**/api/slideshow', (route) => {
    if (slides === 'error') return route.abort();
    return route.fulfill({ json: { slides } });
  });
}

async function openBand(page: Page) {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('.cta-band').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1500);
}

test.describe('CTA band slideshow', () => {
  test('static fallback when API is down: no slides, no dots, no overflow', async ({ page }) => {
    await mockSlideshow(page, 'error');
    await openBand(page);
    await expect(page.locator('.cta-slide')).toHaveCount(0);
    await expect(page.locator('#cta-band-dots')).toHaveCount(0);
    await expect(page.locator('#cta-band-frame .frame-img')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('hydration renders slides, dots, caption; autoplay advances', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await expect(page.locator('.cta-slide')).toHaveCount(2);
    await expect(page.locator('.cta-dot')).toHaveCount(2);
    await expect(page.locator('.cta-slide').first()).toHaveClass(/is-active/);
    await expect(page.locator('#cta-band-caption')).toContainText('Conchas');
    await expect(page.locator('#cta-band-caption')).toContainText('Vanilla and chocolate');
    // autoplay: after ~5.5s the second slide should be active
    await page.waitForTimeout(5600);
    await expect(page.locator('.cta-slide').nth(1)).toHaveClass(/is-active/);
    await expect(page.locator('.cta-dot').nth(1)).toHaveAttribute('aria-current', 'true');
  });

  test('dot click jumps and updates aria-current', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await page.locator('.cta-dot').nth(1).click();
    await expect(page.locator('.cta-slide').nth(1)).toHaveClass(/is-active/);
    await expect(page.locator('#cta-band-caption')).toContainText('Crusty rolls');
  });

  test('hover pauses autoplay', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await page.locator('.cta-band-photo').hover();
    await page.waitForTimeout(5600);
    await expect(page.locator('.cta-slide').first()).toHaveClass(/is-active/);
  });

  test('ES language swap renders ES caption', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await page.evaluate(() => setLang('es'));
    await expect(page.locator('#cta-band-caption')).toContainText('Vainilla y chocolate');
  });

  test('reduced motion: no autoplay, manual dots still work', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await mockSlideshow(page, MOCK_SLIDES);
    await openBand(page);
    await page.waitForTimeout(5600);
    await expect(page.locator('.cta-slide').first()).toHaveClass(/is-active/);
    await page.locator('.cta-dot').nth(1).click();
    await expect(page.locator('.cta-slide').nth(1)).toHaveClass(/is-active/);
    await ctx.close();
  });

  test('no overflow at tablet and mobile widths', async ({ page }) => {
    await mockSlideshow(page, MOCK_SLIDES);
    for (const width of [1024, 861, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await openBand(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 3: Run the suite (needs local worker running for non-mocked nothing — all routes mocked, worker optional)**

Run:
```bash
npx playwright test
```
Expected: all tests pass (the static server is auto-started by the config; API is route-mocked so no worker needed).

Note: `page.evaluate(() => setLang('es'))` works because `setLang` is a global function in the inline script.

- [ ] **Step 4: Also re-run the earlier manual checks**

With the real local worker running (Task 2) and two rows inserted (Task 6 Step 4), open `http://localhost:8901/index.html` once more and confirm GSAP entrances still fire (title/CTAs rise, photo scale-reveal), and the photo frame top stays aligned with the copy card top (the 24px-offset regression from the earlier review stays fixed: figure must have `transform: none` after reveal).

- [ ] **Step 5: Delete the demo page**

```bash
rm slideshow-sample.html
```

- [ ] **Step 6: Update README**

In `README.md`:

1. In the dashboard row description of the Pages table, change:

```
| `/admin/` | `admin/index.html` (built from `home-bakery-management-system/`) | Owner dashboard — orders, products, inventory, customers, payments, labels, **homepage editor**, settings |
```

to:

```
| `/admin/` | `admin/index.html` (built from `home-bakery-management-system/`) | Owner dashboard — orders, products, gallery, **slideshow**, inventory, customers, payments, labels, **homepage editor**, settings |
```

2. In the "Homepage editing" section, add this bullet to the list:

```
- **CTA band slideshow** (`slideshow_slides` table): EN/ES title + description per slide, R2 upload, publish toggle, reorder; public endpoint `GET /api/slideshow` (active only, cap 8). Empty list = static concha photo.
```

3. Add the migration reference to the existing "Migration" bullet area:

```
- Migration: `orders/migrations/0045_slideshow.sql`
```

- [ ] **Step 7: Full verification pass**

Run:
```bash
node --check orders/workers/api.js && cd home-bakery-management-system && npm run build && cd .. && npx playwright test
```
Expected: syntax clean, build succeeds, all Playwright tests pass.

- [ ] **Step 8: Commit**

```bash
git add playwright.config.ts tests/cta-band.spec.ts README.md
git rm --cached slideshow-sample.html 2>/dev/null || true
git commit -m "test: cta band slideshow regression suite; remove demo page; document slideshow"
```

---

### Task 8: Deploy (only when the owner approves going live)

**Files:** none created; remote operations only.

- [ ] **Step 1: Apply the remote migration**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0045_slideshow.sql
```

- [ ] **Step 2: Deploy the orders API worker**

```bash
npx wrangler deploy -c orders/wrangler.toml
```

- [ ] **Step 3: Verify the live public endpoint**

```bash
curl -s https://muy-rico-orders-api.bexgarcia0208.workers.dev/api/slideshow
```
Expected: `{"slides":[]}` (empty until the owner adds slides).

- [ ] **Step 4: Build and upload the site + dashboard**

```bash
cd home-bakery-management-system && npm run build && cd ..
npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21
npx wrangler versions deploy --name muyrico <VERSION_ID>@100%
```

- [ ] **Step 5: Owner smoke test**

Owner: dashboard → Slideshow → add 2-3 slides → check muy-rico.com homepage band rotates; toggle one off → reload → gone; add none → static photo.
