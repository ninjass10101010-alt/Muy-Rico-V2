# Category Filtering + Product Album Gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can filter the order-page menu by category via dynamic pills, and can browse a dedicated product-album gallery of past creations with a deep-link "Request this design" flow back into the matching order-page product.

**Architecture:** New D1 `gallery` table + Worker CRUD (`GET` public, mutate admin). Admin SPA gets a Gallery page that reuses `POST /api/upload`. Static `gallery.html` groups public photos by product. `order.html` gains category pills (cached `allProducts`), deep-link `?product=&design=` handling, and a "View album" link when gallery photos exist for a product. Sidebar marketing category links are removed and replaced by a Gallery nav link.

**Tech Stack:** Cloudflare Workers + D1 + R2, vanilla JS (`order.html`, `gallery.html`), React 19 + Vite + Tailwind (`home-bakery-management-system`), shared `style.css`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-category-filtering-and-gallery-design.md`
- API auth: Cloudflare Access via `cf-access-authenticated-user-email` or `CF_Authorization` cookie; local hostnames bypass. Public exceptions today: `POST /api/orders`, `GET /api/products` (+ id). Add exact-path `GET /api/gallery` only (not `/api/gallery/all`).
- Soft-delete gallery rows (`active = 0`), mirroring products.
- Category pill labels = DB `category` strings as-is (English in both languages); only "All" / "Todos" is bilingual.
- Every gallery photo requires a `product_id` referencing an existing product.
- Uploads reuse existing `POST /api/upload` (R2 `products/` key prefix OK).
- Bilingual UI: new customer-facing strings use `data-es` / `data-en` + existing `applyLangToDOM` / lang toggle patterns.
- Deploy API: `npx wrangler deploy -c orders/wrangler.toml` (or versions upload/deploy if that is the project convention).
- Deploy site/admin: rebuild admin (`cd home-bakery-management-system && npm run build`), then `npx wrangler versions upload --name muyrico --assets .` + deploy.
- Migration: `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=orders/migrations/0015_gallery.sql` then same with `--remote`.
- No checkout/payment changes. No lightbox on order page. No `category_es`. No bulk-reorder endpoint.

## File Map

| Path | Action | Responsibility |
|---|---|---|
| `orders/migrations/0015_gallery.sql` | Create | `gallery` table + indexes |
| `orders/workers/api.js` | Modify | Public list + admin CRUD routes/handlers |
| `home-bakery-management-system/src/types.ts` | Modify | `GalleryPhoto` type |
| `home-bakery-management-system/src/utils/api.ts` | Modify | Gallery API client helpers |
| `home-bakery-management-system/src/pages/Gallery.tsx` | Create | Admin gallery CRUD UI |
| `home-bakery-management-system/src/App.tsx` | Modify | Register `"gallery"` page |
| `home-bakery-management-system/src/components/Sidebar.tsx` | Modify | Nav entry + Images icon |
| `admin/index.html` | Generated | via `npm run build` postbuild |
| `style.css` | Modify | Category pills, gallery layout, design chip, tile highlight |
| `order.html` | Modify | Pills, filter JS, deep-link, album link, nav cleanup |
| `gallery.html` | Create | Public albums page |
| `index.html` | Modify | Gallery nav links; remove dead category marketing links |

---

### Task 1: D1 migration — gallery table

**Files:**
- Create: `orders/migrations/0015_gallery.sql`

**Interfaces:**
- Produces: table `gallery` with columns used by all later API/admin/frontend tasks

- [ ] **Step 1: Write the migration file**

```sql
-- Muy Rico — Gallery table (portfolio albums of past product photos)
-- Linked to products for grouping + "Request this design" deep-links.
-- Run:
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=orders/migrations/0015_gallery.sql
--   npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0015_gallery.sql

CREATE TABLE IF NOT EXISTS gallery (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL,
  title         TEXT NOT NULL,
  title_es      TEXT,
  image_url     TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_gallery_active  ON gallery(active);
CREATE INDEX IF NOT EXISTS idx_gallery_product ON gallery(product_id);
CREATE INDEX IF NOT EXISTS idx_gallery_order   ON gallery(display_order);
```

Note: D1/SQLite may not enforce FK constraints the same way as other DBs; do not rely on `REFERENCES`. API validates `product_id` existence on create/update.

- [ ] **Step 2: Apply migration locally**

```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=orders/migrations/0015_gallery.sql
```

Expected: success / "Executed X commands".

- [ ] **Step 3: Commit**

```bash
git add orders/migrations/0015_gallery.sql
git commit -m "feat(db): add gallery table migration"
```

---

### Task 2: API — gallery list + CRUD

**Files:**
- Modify: `orders/workers/api.js` (auth allowlist ~lines 81–95; route if-chain ~106–169; new handlers after product helpers ~769)

**Interfaces:**
- Produces:
  - `GET /api/gallery` → `{ photos: GalleryPhotoPublic[] }` (public, active only)
  - `GET /api/gallery/all` → `{ photos: GalleryPhoto[] }` (admin, includes inactive)
  - `POST /api/gallery` body `{ product_id, title, title_es?, image_url, display_order?, active? }` → `{ ok: true, id }` 201
  - `PATCH /api/gallery/:id` whitelist fields → `{ ok: true }`
  - `DELETE /api/gallery/:id` soft-delete → `{ ok: true }`
- Photo shape (list public):
  ```js
  {
    id, product_id, title, title_es, image_url, display_order, active,
    product_name, product_name_es, product_emoji, product_display_order
  }
  ```

- [ ] **Step 1: Add public-route allowlist entry** immediately after `isPublicProductGet` (~line 84):

```js
const isPublicGalleryGet = path === '/api/gallery' && method === 'GET';
```

Update the auth guard (~line 94) to:

```js
if (!actorEmail && !isLocal && !isPublicPost && !isPublicProductGet && !isPublicGalleryGet && !isPublicMarkPaid && !isPublicWebhookCreate) {
  return json({ error: 'Unauthorized — Cloudflare Access required' }, 401);
}
```

- [ ] **Step 2: Register routes** in the try block after the products `:id` block (~after line 153):

```js
if (path === '/api/gallery' && method === 'GET') return await listGallery(env);
if (path === '/api/gallery/all' && method === 'GET') return await listGalleryAdmin(env);
if (path === '/api/gallery' && method === 'POST') return await createGalleryPhoto(request, env, actorName);

const gm = path.match(/^\/api\/gallery\/([A-Za-z0-9_-]+)$/);
if (gm) {
  const id = gm[1];
  if (method === 'PATCH')  return await updateGalleryPhoto(id, request, env, actorName);
  if (method === 'DELETE') return await deleteGalleryPhoto(id, env, actorName);
}
```

- [ ] **Step 3: Add handlers** after `deleteProduct` (~line 769):

```js
// ─── Gallery ───────────────────────────────────────────────────────────────

const GALLERY_FIELDS = [
  'product_id', 'title', 'title_es', 'image_url', 'active', 'display_order',
];

function mapGalleryRow(r) {
  return {
    id: r.id,
    product_id: r.product_id,
    title: r.title,
    title_es: r.title_es,
    image_url: r.image_url,
    active: Boolean(r.active),
    display_order: Number(r.display_order) || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
    product_name: r.product_name || null,
    product_name_es: r.product_name_es || null,
    product_emoji: r.product_emoji || null,
    product_display_order: Number(r.product_display_order) || 0,
  };
}

async function listGallery(env) {
  const { results } = await env.DB.prepare(`
    SELECT g.*,
           p.name AS product_name,
           p.name_es AS product_name_es,
           p.emoji AS product_emoji,
           p.display_order AS product_display_order
    FROM gallery g
    LEFT JOIN products p ON p.id = g.product_id
    WHERE g.active = 1
    ORDER BY COALESCE(p.display_order, 9999) ASC, g.display_order ASC, g.created_at ASC
  `).all();
  return json({ photos: (results || []).map(mapGalleryRow) }, 200);
}

async function listGalleryAdmin(env) {
  const { results } = await env.DB.prepare(`
    SELECT g.*,
           p.name AS product_name,
           p.name_es AS product_name_es,
           p.emoji AS product_emoji,
           p.display_order AS product_display_order
    FROM gallery g
    LEFT JOIN products p ON p.id = g.product_id
    ORDER BY COALESCE(p.display_order, 9999) ASC, g.display_order ASC, g.created_at ASC
  `).all();
  return json({ photos: (results || []).map(mapGalleryRow) }, 200);
}

async function createGalleryPhoto(request, env, actor) {
  const body = await request.json();
  if (!body.product_id || !body.title || !body.image_url) {
    return json({ error: 'Missing required fields: product_id, title, image_url' }, 400);
  }
  const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(body.product_id).first();
  if (!product) return json({ error: 'product_id not found' }, 400);

  const id = body.id || `gal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    await env.DB.prepare(`
      INSERT INTO gallery (id, product_id, title, title_es, image_url, active, display_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      body.product_id,
      body.title,
      body.title_es || null,
      body.image_url,
      body.active === false ? 0 : 1,
      Number(body.display_order) || 0,
    ).run();
  } catch (err) {
    return json({ error: String(err) }, 400);
  }
  return json({ ok: true, id }, 201);
}

async function updateGalleryPhoto(id, request, env, actor) {
  const body = await request.json();
  if (body.product_id) {
    const product = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(body.product_id).first();
    if (!product) return json({ error: 'product_id not found' }, 400);
  }
  const sets = [];
  const binds = [];
  for (const f of GALLERY_FIELDS) {
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
  const r = await env.DB.prepare(`UPDATE gallery SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}

async function deleteGalleryPhoto(id, env, actor) {
  const r = await env.DB.prepare(
    `UPDATE gallery SET active = 0, updated_at = datetime('now') WHERE id = ?`
  ).bind(id).run();
  if (!r.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true }, 200);
}
```

- [ ] **Step 4: Verify locally**

```bash
# Terminal A
npx wrangler dev -c orders/wrangler.toml
# Terminal B
curl -s http://127.0.0.1:8787/api/gallery | head -c 200
# Expected: {"photos":[]}
curl -s -X POST http://127.0.0.1:8787/api/gallery \
  -H 'content-type: application/json' \
  -d '{"product_id":"prod_cookie","title":"Test Galaxy Cookie","image_url":"https://example.com/x.jpg"}'
# Expected: {"ok":true,"id":"gal_..."}
curl -s http://127.0.0.1:8787/api/gallery
# Expected: photos array length 1 with product_name filled
curl -s -X DELETE "http://127.0.0.1:8787/api/gallery/<id-from-create>"
# Expected: {"ok":true}
curl -s http://127.0.0.1:8787/api/gallery
# Expected: photos []
curl -s http://127.0.0.1:8787/api/gallery/all
# Expected: photo present with active:false
```

- [ ] **Step 5: Commit**

```bash
git add orders/workers/api.js
git commit -m "feat(api): public gallery list + admin CRUD"
```

---

### Task 3: Admin types + API client

**Files:**
- Modify: `home-bakery-management-system/src/types.ts` (append after `Product` interface ~line 52)
- Modify: `home-bakery-management-system/src/utils/api.ts` (append after `uploadImage` ~line 203)

**Interfaces:**
- Produces TypeScript:
  ```ts
  interface GalleryPhoto {
    id: string;
    product_id: string;
    title: string;
    title_es?: string | null;
    image_url: string;
    active: boolean;
    display_order: number;
    product_name?: string | null;
    product_name_es?: string | null;
    product_emoji?: string | null;
    product_display_order?: number;
  }
  ```
- Client functions: `fetchGalleryAdmin`, `createGalleryPhoto`, `updateGalleryPhoto`, `deleteGalleryPhoto`

- [ ] **Step 1: Add type to `types.ts`**

```ts
export interface GalleryPhoto {
  id: string;
  product_id: string;
  title: string;
  title_es?: string | null;
  image_url: string;
  active: boolean;
  display_order: number;
  product_name?: string | null;
  product_name_es?: string | null;
  product_emoji?: string | null;
  product_display_order?: number;
}
```

- [ ] **Step 2: Add client helpers to `api.ts` after `uploadImage`**

```ts
// ─── Gallery ───────────────────────────────────────────────────────────────

export interface ApiGalleryPhoto {
  id: string;
  product_id: string;
  title: string;
  title_es?: string | null;
  image_url: string;
  active: boolean;
  display_order: number;
  product_name?: string | null;
  product_name_es?: string | null;
  product_emoji?: string | null;
  product_display_order?: number;
}

export interface GalleryPhotoCreate {
  product_id: string;
  title: string;
  title_es?: string | null;
  image_url: string;
  display_order?: number;
  active?: boolean;
}

export type GalleryPhotoUpdate = Partial<GalleryPhotoCreate>;

export async function fetchGalleryAdmin(): Promise<ApiGalleryPhoto[]> {
  const data = await apiFetch<{ photos: ApiGalleryPhoto[] }>("/api/gallery/all");
  return data.photos;
}

export async function createGalleryPhoto(
  p: GalleryPhotoCreate
): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/gallery", {
    method: "POST",
    body: JSON.stringify(p),
  });
}

export async function updateGalleryPhoto(
  id: string,
  patch: GalleryPhotoUpdate
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/gallery/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteGalleryPhoto(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/gallery/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add home-bakery-management-system/src/types.ts home-bakery-management-system/src/utils/api.ts
git commit -m "feat(admin): gallery types and API client"
```

---

### Task 4: Admin Gallery page + nav registration

**Files:**
- Create: `home-bakery-management-system/src/pages/Gallery.tsx`
- Modify: `home-bakery-management-system/src/App.tsx`
- Modify: `home-bakery-management-system/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `fetchGalleryAdmin`, `createGalleryPhoto`, `updateGalleryPhoto`, `deleteGalleryPhoto`, `uploadImage` from api.ts; `useStore().products`
- Produces: page id `"gallery"` renderable from App + Sidebar

- [ ] **Step 1: Create `Gallery.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Modal from "../components/ui/Modal";
import {
  createGalleryPhoto,
  deleteGalleryPhoto,
  fetchGalleryAdmin,
  updateGalleryPhoto,
  uploadImage,
  type ApiGalleryPhoto,
} from "../utils/api";

type Draft = {
  product_id: string;
  title: string;
  title_es: string;
  image_url: string;
};

const emptyDraft = (defaultProductId = ""): Draft => ({
  product_id: defaultProductId,
  title: "",
  title_es: "",
  image_url: "",
});

export default function Gallery() {
  const { products } = useStore();
  const activeProducts = useMemo(
    () => products.filter((p) => p.active !== false),
    [products]
  );
  const [photos, setPhotos] = useState<ApiGalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const rows = await fetchGalleryAdmin();
      setPhotos(rows);
    } catch (e: any) {
      setError(e?.message || "Failed to load gallery");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const groups = useMemo(() => {
    const map = new Map<string, ApiGalleryPhoto[]>();
    for (const ph of photos) {
      const key = ph.product_id || "_unknown";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ph);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.display_order - b.display_order) || a.id.localeCompare(b.id));
    }
    const productOrder = new Map(
      activeProducts.map((p, i) => [p.id, p.display_order ?? i])
    );
    return [...map.entries()].sort((a, b) => {
      const ao = productOrder.get(a[0]) ?? 9999;
      const bo = productOrder.get(b[0]) ?? 9999;
      if (ao !== bo) return ao - bo;
      return a[0].localeCompare(b[0]);
    });
  }, [photos, activeProducts]);

  function openNew() {
    setDraft(emptyDraft(activeProducts[0]?.id || ""));
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
    if (!draft.product_id || !draft.title.trim() || !draft.image_url) {
      setError("Product, title, and image are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const siblings = photos.filter((p) => p.product_id === draft.product_id);
      const nextOrder =
        siblings.length === 0
          ? 0
          : Math.max(...siblings.map((s) => s.display_order || 0)) + 1;
      await createGalleryPhoto({
        product_id: draft.product_id,
        title: draft.title.trim(),
        title_es: draft.title_es.trim() || null,
        image_url: draft.image_url,
        display_order: nextOrder,
        active: true,
      });
      setModalOpen(false);
      await refresh();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(ph: ApiGalleryPhoto) {
    await updateGalleryPhoto(ph.id, { active: !ph.active });
    await refresh();
  }

  async function remove(ph: ApiGalleryPhoto) {
    if (!confirm(`Delete “${ph.title}”?`)) return;
    await deleteGalleryPhoto(ph.id);
    await refresh();
  }

  async function move(ph: ApiGalleryPhoto, dir: -1 | 1) {
    const siblings = photos
      .filter((p) => p.product_id === ph.product_id)
      .sort((a, b) => (a.display_order - b.display_order) || a.id.localeCompare(b.id));
    const idx = siblings.findIndex((s) => s.id === ph.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    await Promise.all([
      updateGalleryPhoto(ph.id, { display_order: swap.display_order }),
      updateGalleryPhoto(swap.id, { display_order: ph.display_order }),
    ]);
    await refresh();
  }

  function productLabel(productId: string, sample?: ApiGalleryPhoto) {
    const p = activeProducts.find((x) => x.id === productId);
    if (p) return `${p.emoji || ""} ${p.name}`.trim();
    if (sample?.product_name) return `${sample.product_emoji || ""} ${sample.product_name}`.trim();
    return productId;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-cocoa">Gallery</h1>
          <p className="text-sm text-cocoa/60">
            Portfolio photos grouped by product. Customers request a design from the public gallery page.
          </p>
        </div>
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-2 rounded-full bg-coral px-4 py-2 text-sm font-semibold text-white shadow hover:opacity-90"
        >
          <Plus size={16} /> Add photo
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-cocoa/50">Loading gallery…</p>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cocoa/20 bg-white p-10 text-center text-sm text-cocoa/60">
          No gallery photos yet. Add your first portfolio shot.
        </div>
      ) : (
        groups.map(([productId, list]) => (
          <section key={productId} className="space-y-3">
            <h2 className="font-serif text-lg text-cocoa">
              {productLabel(productId, list[0])}
              <span className="ml-2 text-sm font-sans font-normal text-cocoa/40">
                ({list.length})
              </span>
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((ph, i) => (
                <article
                  key={ph.id}
                  className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
                    ph.active ? "border-cocoa/10" : "border-cocoa/5 opacity-70"
                  }`}
                >
                  <div className="aspect-square overflow-hidden bg-sand-100">
                    <img
                      src={ph.image_url}
                      alt={ph.title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                  <div className="space-y-2 p-3">
                    <p className="truncate font-medium text-cocoa">{ph.title}</p>
                    {ph.title_es && (
                      <p className="truncate text-xs text-cocoa/50">{ph.title_es}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => move(ph, -1)}
                        className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100 disabled:opacity-30"
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        type="button"
                        title="Move down"
                        disabled={i === list.length - 1}
                        onClick={() => move(ph, 1)}
                        className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100 disabled:opacity-30"
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        type="button"
                        title={ph.active ? "Hide" : "Show"}
                        onClick={() => toggleActive(ph)}
                        className="rounded-lg p-1.5 text-cocoa/60 hover:bg-sand-100"
                      >
                        {ph.active ? <Eye size={16} /> : <EyeOff size={16} />}
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        onClick={() => remove(ph)}
                        className="ml-auto rounded-lg p-1.5 text-red-600/80 hover:bg-red-50"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add gallery photo">
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block text-cocoa/70">Product album</span>
            <select
              className="w-full rounded-xl border border-cocoa/15 bg-white px-3 py-2"
              value={draft.product_id}
              onChange={(e) => setDraft({ ...draft, product_id: e.target.value })}
            >
              <option value="">Select product…</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          </label>
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
              onClick={() => setModalOpen(false)}
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
              {saving ? "Saving…" : "Save photo"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
```

Confirm `Modal` exists at `src/components/ui/Modal.tsx` and accepts `{ open, onClose, title, children }`. If the prop names differ, match the Products page usage of `Modal`.

- [ ] **Step 2: Register in `App.tsx`**

Add import:
```ts
import Gallery from "./pages/Gallery";
```

Extend `Page` union:
```ts
export type Page =
  | "dashboard"
  | "orders"
  | "products"
  | "gallery"
  | "inventory"
  | "customers"
  | "payments"
  | "labels"
  | "settings";
```

Add render dispatch after products:
```tsx
{page === "gallery" && <Gallery />}
```

- [ ] **Step 3: Register in `Sidebar.tsx`**

Add `Images` to the lucide-react import list. Insert after products:

```ts
{ id: "gallery", label: "Gallery", icon: Images },
```

- [ ] **Step 4: Build admin and fix TypeScript errors**

```bash
cd home-bakery-management-system && npm run build
```

Expected: clean build; `admin/index.html` updated via postbuild.

- [ ] **Step 5: Commit**

```bash
git add home-bakery-management-system/src/pages/Gallery.tsx \
  home-bakery-management-system/src/App.tsx \
  home-bakery-management-system/src/components/Sidebar.tsx \
  admin/index.html
git commit -m "feat(admin): Gallery page for portfolio photo CRUD"
```

---

### Task 5: Shared CSS — pills, gallery, deep-link chip

**Files:**
- Modify: `style.css` (append near existing filter styles ~303, and a new gallery section near end before media queries if cleaner)

**Interfaces:**
- Produces CSS classes: `.category-pills`, `.category-pill`, `.category-pill.active`, `.gallery-shell` (reuse site shell), `.gallery-album`, `.gallery-grid`, `.gallery-card`, `.gallery-request-btn`, `.tile-design-chip`, `.tile-highlight`, `.tile-album-link`

- [ ] **Step 1: Append styles to `style.css`** (after `.filter-count` block ~310 is fine for pills; gallery can follow product-tile section near ~1050 or end of file before the last media query):

```css
/* ── Category filter pills (order page) ───────────────────────── */
.category-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 1.5rem;
  padding: 0 0.25rem;
}
.category-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid rgba(139, 90, 78, 0.18);
  background: rgba(255, 255, 255, 0.72);
  color: var(--color-text-muted);
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  cursor: pointer;
  transition: var(--transition-smooth);
}
.category-pill:hover {
  background: rgba(251, 203, 201, 0.35);
  color: var(--color-text-cocoa);
}
.category-pill.active {
  background: rgba(251, 203, 201, 0.55);
  color: var(--color-text-cocoa);
  border-color: rgba(247, 168, 164, 0.55);
}
.category-pill .filter-count {
  background: rgba(255, 255, 255, 0.75);
}

/* Design request chip + highlight on order tiles */
.tile-design-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0 0 0.65rem;
  padding: 0.45rem 0.65rem;
  border-radius: 12px;
  background: rgba(212, 237, 218, 0.55);
  border: 1px solid rgba(109, 166, 123, 0.35);
  font-size: 0.78rem;
  color: var(--color-text-cocoa);
  font-weight: 600;
}
.tile-design-chip button {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  color: var(--color-text-muted);
  padding: 0 0.15rem;
}
.product-tile.tile-highlight {
  outline: 2px solid var(--color-accent-coral);
  outline-offset: 3px;
  box-shadow: 0 0 0 6px rgba(247, 168, 164, 0.28);
  animation: tile-pulse 1.2s ease-in-out 0s 3;
}
@keyframes tile-pulse {
  0%, 100% { box-shadow: 0 0 0 4px rgba(247, 168, 164, 0.2); }
  50% { box-shadow: 0 0 0 10px rgba(247, 168, 164, 0.35); }
}
@media (prefers-reduced-motion: reduce) {
  .product-tile.tile-highlight { animation: none; }
}
.tile-album-link {
  display: inline-block;
  margin: 0.15rem 0 0.55rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--color-bright-hibiscus);
  text-decoration: none;
}
.tile-album-link:hover { text-decoration: underline; }

/* ── Public gallery page ──────────────────────────────────────── */
.gallery-hero-desc { max-width: 36rem; margin-inline: auto; }
.gallery-albums { display: flex; flex-direction: column; gap: 2.75rem; padding-bottom: 3rem; }
.gallery-album-header {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  margin-bottom: 1rem;
}
.gallery-album-header h2 {
  font-family: var(--font-display, "Cormorant Garamond", serif);
  font-size: clamp(1.6rem, 3vw, 2.1rem);
  color: var(--color-text-cocoa);
  margin: 0;
}
.gallery-album-emoji { font-size: 1.6rem; line-height: 1; }
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.25rem;
}
.gallery-card {
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(139, 90, 78, 0.1);
  border-radius: 1.15rem;
  overflow: hidden;
  box-shadow: 0 10px 28px rgba(73, 48, 36, 0.06);
  display: flex;
  flex-direction: column;
}
.gallery-card-img {
  aspect-ratio: 1 / 1;
  width: 100%;
  object-fit: cover;
  display: block;
  background: rgba(251, 243, 233, 0.8);
}
.gallery-card-body {
  padding: 0.9rem 1rem 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  flex: 1;
}
.gallery-card-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-cocoa);
}
.gallery-request-btn {
  margin-top: auto;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  border: 0;
  border-radius: 999px;
  padding: 0.55rem 0.9rem;
  font: inherit;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  text-decoration: none;
  color: #fff;
  background: linear-gradient(135deg, var(--color-accent-coral), var(--color-bright-hibiscus));
  cursor: pointer;
  transition: var(--transition-smooth);
}
.gallery-request-btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
.gallery-empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--color-text-muted);
  font-size: 1.05rem;
}
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "style: category pills, gallery cards, design-request chip"
```

---

### Task 6: Order page — category pills + filter + nav cleanup

**Files:**
- Modify: `order.html` (sidebar ~498–503, mobile drawer ~466–468, menu section ~580–585, script ~982–1079 + data-category on static tiles)

**Interfaces:**
- Produces: module-level `allProducts`, `activeCategory`, `galleryProductIds` (Set), `renderCategoryPills`, `filterByCategory`
- Consumes: existing `renderProducts`, `refreshTileStates`, `initProductReveals`, `applyLangToDOM`

- [ ] **Step 1: Update mobile drawer** — replace the three category links (lines 466–468) with one Gallery link:

```html
      <a href="index.html" data-es="Nuestra Casa" data-en="Our Home">Our Home</a>
      <a href="order.html" class="active" data-es="Ordenar" data-en="Order">Order</a>
      <a href="gallery.html" data-es="Galería" data-en="Gallery">Gallery</a>
```

- [ ] **Step 2: Update sidebar nav** — replace Categorías filter-list (lines 498–503) with:

```html
        <div class="nav-group-label" style="margin-top:0.8rem;" data-es="Explorar" data-en="Explore">Explorar</div>
        <div class="section-list">
          <a href="gallery.html" class="section-link" data-es="Galería" data-en="Gallery">Galería</a>
        </div>
```

- [ ] **Step 3: Insert pill host above the grid** — change the menu section opening so pills sit under the label row:

```html
      <section class="featured-section" id="menu" style="padding-top:1.5rem;">
        <div class="section-label-row">
          <span class="section-label lang-fade" data-es="Nuestro Menú" data-en="Our Menu">Nuestro Menú</span>
          <div class="section-rule"></div>
        </div>
        <div class="category-pills" id="category-pills" hidden></div>
        <div class="products-grid" id="products-grid">
```

- [ ] **Step 4: Add `data-category` to each static fallback tile**

For known categories from seed / fallback content:
- cookies tile → `data-category="Cookies"`
- other fallback tiles: match their product type (`Bread`, `Cupcakes`, `Cakes`, `Cakepops`, etc.) based on the product name/id already on the tile. Grep the tile `id="tile-..."` values and assign:
  - cookie-like → Cookies
  - concha / tortilla / bolillo / bread-like → Bread
  - cupcake → Cupcakes
  - cake → Cakes
  - cakepop → Cakepops

Example attribute addition on the article tag:
```html
<article class="product-tile ..." id="tile-cookies" data-category="Cookies" ...>
```

- [ ] **Step 5: Script changes** — after `const ORDER_API = ...` (~973), add state:

```js
    let allProducts = [];
    let activeCategory = 'all';
    let galleryProductIds = new Set();
```

Update `renderProductTile` article attributes to include category and optional album link. After `data-image-url=...` add:

```js
          data-category="${escapeHtml(p.category || '')}"
          data-product-id="${escapeHtml(p.id)}"
```

After the description `<p class="tile-desc...">` line, insert album link when product has gallery photos:

```js
      const albumLink = galleryProductIds.has(p.id)
        ? `<a class="tile-album-link lang-fade" href="gallery.html#album-${escapeHtml(p.id)}" data-es="📸 Ver álbum" data-en="📸 View album">📸 View album</a>`
        : '';
```

And in the returned HTML, after the desc paragraph:

```
          ${albumLink}
```

Replace `renderProducts` + `loadProducts` with:

```js
    function renderCategoryPills(products) {
      const host = document.getElementById('category-pills');
      if (!host) return;
      const counts = new Map();
      (products || []).forEach(p => {
        const cat = (p.category || '').trim();
        if (!cat) return;
        counts.set(cat, (counts.get(cat) || 0) + 1);
      });
      if (!counts.size) {
        host.hidden = true;
        host.innerHTML = '';
        return;
      }
      host.hidden = false;
      const cats = [...counts.keys()];
      const allCount = products.length;
      const pills = [
        `<button type="button" class="category-pill ${activeCategory === 'all' ? 'active' : ''}" data-category="all">
           <span class="lang-fade" data-es="Todos" data-en="All">All</span>
           <span class="filter-count">${allCount}</span>
         </button>`,
        ...cats.map(cat => `
          <button type="button" class="category-pill ${activeCategory === cat ? 'active' : ''}" data-category="${escapeHtml(cat)}">
            <span>${escapeHtml(cat)}</span>
            <span class="filter-count">${counts.get(cat)}</span>
          </button>`)
      ];
      host.innerHTML = pills.join('');
      host.querySelectorAll('.category-pill').forEach(btn => {
        btn.addEventListener('click', () => filterByCategory(btn.getAttribute('data-category') || 'all'));
      });
      applyLangToDOM(currentLang);
    }

    function filterByCategory(cat) {
      activeCategory = cat || 'all';
      const source = allProducts.length
        ? allProducts
        : null;
      if (source) {
        const filtered = activeCategory === 'all'
          ? source
          : source.filter(p => (p.category || '').toLowerCase() === activeCategory.toLowerCase());
        renderProducts(filtered);
      } else {
        // Fallback tiles path: show/hide by data-category
        document.querySelectorAll('#products-grid .product-tile').forEach(tile => {
          const tcat = (tile.getAttribute('data-category') || '').toLowerCase();
          const show = activeCategory === 'all' || tcat === activeCategory.toLowerCase();
          tile.style.display = show ? '' : 'none';
        });
        if (window.initProductReveals) initProductReveals();
        if (typeof refreshTileStates === 'function') refreshTileStates();
      }
      renderCategoryPills(source || collectFallbackProducts());
    }

    function collectFallbackProducts() {
      return [...document.querySelectorAll('#products-grid .product-tile')].map(tile => ({
        id: (tile.id || '').replace(/^tile-/, ''),
        category: tile.getAttribute('data-category') || '',
      }));
    }

    function renderProducts(products) {
      const grid = document.getElementById('products-grid');
      if (!grid) return;
      if (!products || !products.length) {
        grid.innerHTML = '<p class="lang-fade" data-es="No hay productos disponibles." data-en="No products available.">No products available.</p>';
        renderCategoryPills(allProducts);
        return;
      }
      grid.innerHTML = products.map(renderProductTile).join('');
      applyLangToDOM(currentLang);
      grid.querySelectorAll('.pack-selects').forEach(ps => {
        const firstOpt = ps.querySelector('.pack-option');
        if (firstOpt) selectPack(firstOpt);
      });
      if (window.initProductReveals) initProductReveals();
      if (typeof refreshTileStates === 'function') refreshTileStates();
      renderCategoryPills(allProducts);
      if (typeof applyDesignDeepLink === 'function') applyDesignDeepLink();
    }

    async function loadProducts() {
      try {
        const res = await fetch((ORDER_API || '') + '/api/products');
        if (!res.ok) throw new Error('products fetch failed: ' + res.status);
        const data = await res.json();
        allProducts = data.products || [];
        activeCategory = 'all';
        // gallery product ids for album links (non-blocking)
        try {
          const gRes = await fetch((ORDER_API || '') + '/api/gallery');
          if (gRes.ok) {
            const gData = await gRes.json();
            galleryProductIds = new Set((gData.photos || []).map(ph => ph.product_id));
          }
        } catch (_) { /* ignore */ }
        renderProducts(allProducts);
      } catch (err) {
        console.warn('Could not load live products, showing fallback menu:', err);
        allProducts = [];
        renderCategoryPills(collectFallbackProducts());
        if (window.initProductReveals) initProductReveals();
      }
    }
```

Important: declare `function applyDesignDeepLink` later in Task 7 *before* first use, or use a named function declaration (hoisted). Prefer a function declaration in Task 7 so it hoists.

- [ ] **Step 6: Manual browser check (local static + local API)**

1. Serve site (any static server) and `wrangler dev` for API.
2. Click category pills → grid shows only that category; counts update; All restores full list.
3. Add an item to cart, switch category away and back → in-cart badge still present.
4. Sidebar/mobile show Gallery, no old Conchas links.

- [ ] **Step 7: Commit**

```bash
git add order.html
git commit -m "feat(order): dynamic category filter pills and gallery nav"
```

---

### Task 7: Order page — deep-link design request + addToCart note

**Files:**
- Modify: `order.html` (`addToCart` ~1247–1298; add deep-link helpers near product script)

**Interfaces:**
- URL: `order.html?product=<product_id>&design=<title>#tile-<product_id>`
- DOM: `data-design` on tile; `.tile-design-chip` UI; `.tile-highlight` class
- Cart: `flavorNote` gains ` — Design: <title>` (OR ` — Diseño: <title>` when `currentLang === 'es'`)

- [ ] **Step 1: Add deep-link helpers** after `escapeHtml`:

```js
    function getDesignParams() {
      try {
        const sp = new URLSearchParams(location.search);
        const product = sp.get('product') || '';
        const design = sp.get('design') || '';
        return { product, design };
      } catch {
        return { product: '', design: '' };
      }
    }

    function clearDesignFromTile(tile) {
      if (!tile) return;
      tile.removeAttribute('data-design');
      const chip = tile.querySelector('.tile-design-chip');
      if (chip) chip.remove();
    }

    function applyDesignDeepLink() {
      const { product, design } = getDesignParams();
      if (!product || !design) return;
      const tile = document.getElementById('tile-' + product);
      if (!tile) return;

      tile.setAttribute('data-design', design);

      let chip = tile.querySelector('.tile-design-chip');
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'tile-design-chip';
        const titleEl = tile.querySelector('.tile-title');
        if (titleEl) titleEl.insertAdjacentElement('afterend', chip);
        else tile.prepend(chip);
      }
      chip.innerHTML = `
        <span class="lang-fade"
          data-es="Diseño solicitado: ${escapeHtml(design)}"
          data-en="Requested design: ${escapeHtml(design)}">Requested design: ${escapeHtml(design)}</span>
        <button type="button" aria-label="Dismiss">&times;</button>`;
      chip.querySelector('button').onclick = () => {
        clearDesignFromTile(tile);
        try {
          const url = new URL(location.href);
          url.searchParams.delete('design');
          url.searchParams.delete('product');
          history.replaceState({}, '', url.pathname + url.search + url.hash);
        } catch (_) {}
      };
      applyLangToDOM(currentLang);

      tile.classList.add('tile-highlight');
      try { tile.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' }); } catch (_) {}
      if (!prefersReduced) {
        setTimeout(() => tile.classList.remove('tile-highlight'), 4000);
      } else {
        setTimeout(() => tile.classList.remove('tile-highlight'), 2000);
      }
    }
```

- [ ] **Step 2: Append design to flavorNote in `addToCart`** — after flavorNote assembly (~1273–1275), before `displayName = ...`:

```js
      const designReq = tile.getAttribute('data-design');
      if (designReq) {
        const designLabel = currentLang === 'es' ? 'Diseño' : 'Design';
        flavorNote = (flavorNote || '') + ' — ' + designLabel + ': ' + designReq;
      }
```

Also update `displayName` assignment so it keeps using the (now extended) `flavorNote`. no other change needed if `displayName = displayName + packLabel + flavorNote` runs after this.

- [ ] **Step 3: Ensure deep-link runs after products load** — already called from `renderProducts` via `applyDesignDeepLink()` (Task 6). For fallback static path when loadProducts fails, also call `applyDesignDeepLink()` at end of the catch branch.

- [ ] **Step 4: Browser check**

Open:
`order.html?product=prod_cookie&design=Galaxy%20Cookie#tile-prod_cookie`
(use a real product id from API). Expect: scroll, pulse outline, chip visible, Add to cart → cart line includes `Design: Galaxy Cookie`.

- [ ] **Step 5: Commit**

```bash
git add order.html
git commit -m "feat(order): deep-link design request onto product tile and cart"
```

---

### Task 8: Public gallery page

**Files:**
- Create: `gallery.html`

**Interfaces:**
- Consumes: `GET /api/gallery`
- Produces: album sections `#album-<product_id>` and buttons linking to `order.html?product=...&design=...#tile-...`

- [ ] **Step 1: Create `gallery.html`**

Scaffold from `order.html` shell (header, sidebar, mobile drawer, footer, lang toggle, GSAP). Do **not** copy order form / cart / checkout. Key structure and script:

HTML main region:
```html
<section class="featured-section" id="gallery" style="padding-top:2rem;">
  <div class="section-label-row">
    <span class="section-label lang-fade" data-es="Nuestro Álbum" data-en="Our Album">Nuestro Álbum</span>
    <div class="section-rule"></div>
  </div>
  <p class="hero-description gallery-hero-desc lang-fade"
     data-es="Inspiración de creaciones pasadas. ¿Te gusta un diseño? Pídelo en tu pedido."
     data-en="Inspiration from past creations. Love a design? Request it on your order.">
    Inspiración de creaciones pasadas. ¿Te gusta un diseñ? Pídelo en tu pedido.
  </p>
  <div id="gallery-root" class="gallery-albums" aria-live="polite"></div>
</section>
```

Nav (sidebar + mobile) must include:
- Home → `index.html`
- Order → `order.html`
- Gallery → `gallery.html` (active)

Script essentials (mirror ORDER_API / lang patterns from order.html):

```js
const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const ORDER_API = isDev ? 'http://localhost:8787' : '';
let currentLang = 'es';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'&quot;',"'":'&#39;'}[c]));
}

function applyLangToDOM(lang) {
  document.querySelectorAll('[data-es][data-en]').forEach(el => {
    el.textContent = lang === 'es' ? el.getAttribute('data-es') : el.getAttribute('data-en');
  });
  // Keep any setLang button/aria pattern used on order.html — copy setLang() wholesale from order.html if needed.
}

function groupPhotos(photos) {
  const map = new Map();
  for (const ph of photos) {
    const key = ph.product_id;
    if (!map.has(key)) {
      map.set(key, {
        product_id: key,
        product_name: ph.product_name || key,
        product_name_es: ph.product_name_es || ph.product_name || key,
        product_emoji: ph.product_emoji || '📸',
        product_display_order: ph.product_display_order || 0,
        photos: [],
      });
    }
    map.get(key).photos.push(ph);
  }
  return [...map.values()].sort((a, b) => a.product_display_order - b.product_display_order);
}

function renderGallery(photos) {
  const root = document.getElementById('gallery-root');
  if (!root) return;
  if (!photos.length) {
    root.innerHTML = `<p class="gallery-empty lang-fade" data-es="Nuestro álbum llegará pronto." data-en="Our album is coming soon.">Our album is coming soon.</p>`;
    applyLangToDOM(currentLang);
    return;
  }
  const groups = groupPhotos(photos);
  root.innerHTML = groups.map(g => `
    <section class="gallery-album reveal" id="album-${escapeHtml(g.product_id)}">
      <div class="gallery-album-header">
        <span class="gallery-album-emoji">${g.product_emoji || '📸'}</span>
        <h2 class="lang-fade" data-es="${escapeHtml(g.product_name_es)}" data-en="${escapeHtml(g.product_name)}">${escapeHtml(g.product_name)}</h2>
      </div>
      <div class="gallery-grid">
        ${g.photos.map(ph => {
          const title = ph.title;
          const titleEs = ph.title_es || ph.title;
          const href = `order.html?product=${encodeURIComponent(ph.product_id)}&design=${encodeURIComponent(ph.title)}#tile-${encodeURIComponent(ph.product_id)}`;
          return `
            <article class="gallery-card">
              <img class="gallery-card-img" src="${escapeHtml(ph.image_url)}" alt="${escapeHtml(title)}" loading="lazy" />
              <div class="gallery-card-body">
                <h3 class="gallery-card-title lang-fade" data-es="${escapeHtml(titleEs)}" data-en="${escapeHtml(title)}">${escapeHtml(title)}</h3>
                <a class="gallery-request-btn lang-fade" href="${href}"
                   data-es="Pedir este diseño" data-en="Request this design">Request this design</a>
              </div>
            </article>`;
        }).join('')}
      </div>
    </section>
  `).join('');
  applyLangToDOM(currentLang);
  if (window.initGalleryReveals) initGalleryReveals();
  // Honor hash #album-...
  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function loadGallery() {
  const root = document.getElementById('gallery-root');
  try {
    const res = await fetch((ORDER_API || '') + '/api/gallery');
    if (!res.ok) throw new Error('gallery fetch failed');
    const data = await res.json();
    renderGallery(data.photos || []);
  } catch (err) {
    console.warn(err);
    if (root) {
      root.innerHTML = `<p class="gallery-empty lang-fade" data-es="No se pudo cargar el álbum." data-en="Could not load the album.">Could not load the album.</p>`;
      applyLangToDOM(currentLang);
    }
  }
}

// Init lang from localStorage, setLang buttons, GSAP reveals (copy patterns from order.html), then loadGallery().
```

Copy the header/sidebar/footer markup from `order.html`, stripping cart/checkout-only pieces. Fix typo in Spanish empty-state text to `diseño` (with accent). Keep GSAP + language machinery consistent enough that ES/EN toggle works.

- [ ] **Step 2: Browser check**

With at least one active photo in D1 (create via local API/admin):
- albums group correctly
- hash `#album-prod_...` scrolls to section
- Request button lands on order page with deep-link chip
- ES/EN toggle updates titles and button label
- With empty gallery, empty state shows

- [ ] **Step 3: Commit**

```bash
git add gallery.html
git commit -m "feat: public product album gallery page"
```

---

### Task 9: index.html nav cleanup + Gallery link

**Files:**
- Modify: `index.html` (mobile drawer ~55–60, sidebar ~87–94)

- [ ] **Step 1: Mobile drawer** — replace the three product marketing links with Gallery:

```html
      <a href="index.html" class="active" data-es="Nuestra Casa" data-en="Our Home">Our Home</a>
      <a href="order.html" data-es="Ordenar" data-en="Order">Order</a>
      <a href="gallery.html" data-es="Galería" data-en="Gallery">Gallery</a>
```

- [ ] **Step 2: Sidebar** — replace Categories filter-list with Explore → Gallery:

```html
        <div class="nav-group-label" style="margin-top:0.8rem;" data-es="Explorar" data-en="Explore">Explorar</div>
        <div class="section-list">
          <a href="gallery.html" class="section-link" data-es="Galería" data-en="Gallery">Galería</a>
        </div>
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(home): gallery nav link; remove stale category links"
```

---

### Task 10: End-to-end verification + deploy checklist

**Files:** none (verification only)

- [ ] **Step 1: Local full path**
  1. Migrate local D1 if not already.
  2. `npx wrangler dev -c orders/wrangler.toml`
  3. `cd home-bakery-management-system && npm run build && npm run dev` (or open admin against local API).
  4. Admin → Gallery → upload a photo on an existing product, confirm list + reorder + hide + delete.
  5. Open `gallery.html` → photo visible → Request this design → order tile chip → add to cart → note includes Design.
  6. Order page pills filter correctly; View album only on products with photos.
  7. index/order galleries nav links work on mobile + desktop.

- [ ] **Step 2: Production deploy (when ready; do not force)**
  1. `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/0015_gallery.sql`
  2. Deploy API worker (`npx wrangler deploy -c orders/wrangler.toml` or versions flow).
  3. `cd home-bakery-management-system && npm run build`
  4. Deploy static assets worker `muyrico`.
  5. Smoke-test production: `/api/gallery`, `/gallery.html`, `/order`, admin Gallery.

- [ ] **Step 3: Final commit of any remaining fixups** (only if verification found bugs)

---

## Spec Coverage Checklist

| Spec requirement | Task |
|---|---|
| Dynamic category pills from product data | 6 |
| All pill + count badges | 5, 6 |
| Filter re-render + reveals + cart tile state | 6 |
| English category names both langs | 6 (global constraint) |
| Remove sidebar/mobile marketing category links | 6, 9 |
| Gallery D1 table | 1 |
| Public GET /api/gallery + admin CRUD | 2 |
| Admin Gallery page + nav | 3, 4 |
| Reuse R2 upload | 4 |
| gallery.html albums by product | 8 |
| Request this design deep-link | 7, 8 |
| Design chip + addToCart flavorNote | 7 |
| View album link when photos exist | 6 |
| index.html Gallery nav | 9 |
| Soft delete | 2 |
| Empty/failure gallery states | 8 |
| Deploy order | 10 |

## Self-Review Notes

- No TBD placeholders.
- Types/names consistent: `GalleryPhoto` / `ApiGalleryPhoto`, routes `/api/gallery` and `/api/gallery/all`.
- Modal props: implementer must align with existing `Modal` API used in Products (verify before locking save button).
- Typo watch in gallery.html Spanish strings (`diseño`).
