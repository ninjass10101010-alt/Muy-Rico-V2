# Menu Category Filtering + Product Album Gallery

**Date:** 2026-07-21
**Status:** Approved

---

## Objective

Two related improvements to the customer ordering experience:

1. **Category filtering** — the sidebar "Categorías" links on `order.html` currently only smooth-scroll to `#menu`; customers see the entire menu regardless. Clicking a category should show *only* items from that category.
2. **Product albums (gallery)** — a dedicated gallery page displaying photos of past creations (e.g., different cupcake designs), grouped per product, each with a "Request this design" button that deep-links to the order page with the design pre-referenced on the matching product.

### Decisions locked during brainstorming

| Question | Decision |
|---|---|
| Album concept | Hybrid: portfolio of past work + per-photo order link |
| Album entry point | Dedicated gallery page (not a lightbox on the order page) |
| Photo management | Admin dashboard managed (D1 + existing R2 upload pipeline) |
| "Request this design" flow | Deep-link to order page with design pre-filled as a note on the matching product |
| Filter UX | Dynamic pills above the menu grid, generated from product data |
| Category pill language | DB category names (English) shown as-is in both languages for now |
| Sidebar category links | Removed (replaced by pills + a Gallery nav link) |

---

## Feature 1 — Category Filtering (`order.html` only)

### Current state

- Products are fetched from `GET /api/products` and rendered flat into `#products-grid` (`renderProducts`, order.html:1051–1066). The products array is **not retained** after render.
- Sidebar (order.html:498–503) and mobile drawer (466–468) contain 3 hard-coded marketing-grouping links ("Conchas & Pan Dulce", etc.) whose labels do not match DB `category` values (`'Bread'`, `'Cookies'`, `'Cakepops'`, `'Cakes'`, `'Cupcakes'`).
- No `data-category` attribute exists on tiles; no filter JS exists.
- `.filter-link.active` (style.css:299–302) and `.filter-count` (style.css:303–310) styles exist but are unused.

### Design

- **Cache products**: new module-level `allProducts` array set inside `loadProducts()` before `renderProducts()`.
- **Pill bar**: new `<div class="category-pills">` inserted directly above `#products-grid`. `renderCategoryPills(products)` builds one pill per unique `category` value (ordered by first appearance in `display_order` order), preceded by an **"All / Todos"** pill (active by default). Each pill shows the category name and an item count badge (`.filter-count`). Pills display DB category names as-is in both languages (no `data-es` translation for now; the "All" pill gets `data-es="Todos"`).
- **Filtering**: `filterByCategory(cat)` sets active-pill state, filters `allProducts` (case-insensitive match on `category`), calls `renderProducts(filtered)`, then re-runs `initProductReveals()`, `refreshTileStates()` (preserves in-cart highlighting), and `applyLangToDOM()`.
- **Static fallback tiles** (the 7 hard-coded NO-JS tiles) get `data-category` attributes added manually so pill filtering also works when the API fetch fails. Pill bar is built from the static tiles' categories in the fallback path (or hidden if it can't be derived — simplest: derive from DOM `data-category` values).
- **Sidebar cleanup**: remove the 3 category `<a class="filter-link">` entries from the sidebar "Categorías" group and from the mobile drawer. Replace the group with a single **"Galería / Gallery"** link to `gallery.html`.
- **Empty state**: pills derive only from categories present in the rendered products, so an empty category is impossible. If the API returns zero products, the pill bar is hidden.

---

## Feature 2 — Gallery (albums of past creations)

### 1. Data Model — new migration `orders/migrations/0015_gallery.sql`

```sql
CREATE TABLE IF NOT EXISTS gallery (
  id            TEXT PRIMARY KEY,
  product_id    TEXT NOT NULL REFERENCES products(id),
  title         TEXT NOT NULL,              -- English title, e.g. "Unicorn Cupcakes"
  title_es      TEXT,                       -- Spanish title
  image_url     TEXT NOT NULL,              -- R2 URL from POST /api/upload
  active        INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_gallery_active  ON gallery(active);
CREATE INDEX IF NOT EXISTS idx_gallery_product ON gallery(product_id);
CREATE INDEX IF NOT EXISTS idx_gallery_order   ON gallery(display_order);
```

Header comment documents the local + `--remote` `npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --file=...` commands, matching existing migration style.

- `product_id` is **required** — every photo belongs to a product album (enables grouping and the deep-link target).
- Delete is **soft** (`active = 0`), mirroring `deleteProduct`.

### 2. API Worker (`orders/workers/api.js`)

New routes in the flat if-chain, mirroring the products route pattern:

| Route | Auth | Handler |
|---|---|---|
| `GET /api/gallery` | **Public** | `listGallery(env)` — joins `products` for `name`, `name_es`, `emoji`; returns active photos ordered `products.display_order, gallery.display_order, gallery.created_at` |
| `GET /api/gallery/all` | Admin | `listGalleryAdmin(env)` — includes inactive photos (for the admin grid) |
| `POST /api/gallery` | Admin | `createGalleryPhoto(request, env, actorName)` — validates `product_id`, `title`, `image_url` required; generates id `gal_<rand>` |
| `PATCH /api/gallery/:id` | Admin | `updateGalleryPhoto(id, request, env, actorName)` — whitelist `GALLERY_FIELDS = ['product_id','title','title_es','image_url','active','display_order']`, sets `updated_at` |
| `DELETE /api/gallery/:id` | Admin | `deleteGalleryPhoto(id, env, actorName)` — soft delete |

Auth change: add `isPublicGalleryGet` (exact-path `path === '/api/gallery' && method === 'GET'`) and OR it into the public-route bypass at api.js:94. All other gallery routes fall through to the existing Cloudflare Access check automatically. `GET /api/gallery/all` stays admin-only so inactive photos aren't publicly enumerable.

Photo uploads reuse the existing `POST /api/upload` endpoint unchanged (R2 keys land under `products/` prefix — acceptable; generalizing the prefix is out of scope).

### 3. Admin Dashboard (`home-bakery-management-system/`)

- **`src/types.ts`**: new `GalleryPhoto` interface (`id`, `product_id`, `title`, `title_es?`, `image_url`, `active`, `display_order`).
- **`src/utils/api.ts`**: `fetchGallery()`, `createGalleryPhoto()`, `updateGalleryPhoto()`, `deleteGalleryPhoto()` — same `fetch` patterns as the products helpers; uploads reuse existing `uploadImage()` (api.ts:194–203).
- **`src/pages/Gallery.tsx`** (new): photos grouped by product (product dropdown data from `StoreContext`). Each group: product name header + card grid. Cards show the photo, title, inactive badge if `active = 0`, and controls:
  - **Add photo** button opens a form: file input → `uploadImage()`, product `<select>`, `title` + `title_es` inputs.
  - **Up/down arrows** reorder within the product group — swap `display_order` of the two neighbors via two `PATCH` calls (no bulk endpoint; photo counts are small).
  - **Active toggle** (eye icon) → `PATCH active`.
  - **Delete** with confirm → `DELETE`.
- **Registration**: extend `Page` union with `"gallery"` (App.tsx:16–24), add render dispatch `{page === "gallery" && <Gallery .../>}` (App.tsx:55–62), add `{ id: "gallery", label: "Gallery", icon: Images }` to Sidebar NAV (Sidebar.tsx:15–24).
- Build with `npm run build` (postbuild copies the single-file bundle to `admin/index.html`).

### 4. Gallery Page (`gallery.html`, new static page)

- Matches site design: links `style.css`, same header/nav as `order.html`, Google Fonts, GSAP 3 + ScrollTrigger from CDN, bilingual `data-es`/`data-en` with the same `currentLang` toggle pattern as `order.html`.
- Fetches `(ORDER_API || '') + '/api/gallery'` on load (`ORDER_API` defined the same way as order.html).
- **Album sections**: photos grouped by product, in product display order. Each section: `<h2>` with product emoji + bilingual product name, anchored `id="album-<product_id>"` (so order-page tiles can link directly to an album).
- **Photo cards**: image (`loading="lazy"`), title (bilingual), and a **"Request this design / Pedir este diseño"** button → `order.html?product=<product_id>&design=<encodeURIComponent(title)>#tile-<product_id>`.
- **Failure/empty state**: friendly bilingual message ("Our album is coming soon / Nuestro álbum llegará pronto") instead of tiles; no hard-coded fallback photos.
- Reveal animations respect the existing `prefersReduced` pattern.

### 5. Deep-Link Handling (`order.html`)

- On load, parse `new URLSearchParams(location.search)` for `product` and `design`.
- After products render (both API and fallback paths): if `product` matches a tile id:
  - Scroll `#tile-<product_id>` into view.
  - Add a `tile-highlight` CSS class (pulsing outline animation, removed after a few seconds).
  - Pin a dismissible chip at the top of the tile: `Diseño solicitado: <design> ✕` / `Requested design`. Dismiss clears the attribute.
  - Set `data-design="<design>"` on the tile element.
- `addToCart(btn)` (order.html:1247–1346): after computing `flavorNote`, if `tile.dataset.design` is set, append ` — Design: <design>` (or ` — Diseño: <design>` per current language) to `flavorNote`. The design reference then flows through the existing cart → `POST /api/orders` pipeline unchanged (cart lines already carry `flavorNote`).

### 6. Cross-Linking & Nav

- `index.html` + `order.html` nav (desktop sidebar + mobile drawer): add **"Galería / Gallery"** link to `gallery.html`.
- Order-page tiles: `renderProductTile` adds a small **"📸 Ver álbum / View album"** text link under the description, pointing to `gallery.html#album-<product_id>`, rendered only when the product has gallery photos. The gallery photo-count per product comes from `GET /api/gallery` (fetched once on the order page; tiles re-rendered or link hidden if the fetch fails — links degrade gracefully by simply not appearing). Static fallback tiles do not get the link.

---

## Build & Deploy Order (dependencies)

1. **Migration + API worker**: run `0015_gallery.sql` locally + `--remote`, then `npx wrangler deploy -c orders/wrangler.toml`. Endpoints must exist before admin/gallery can use them.
2. **Admin dashboard**: `cd home-bakery-management-system && npm run build` → deploy static worker (`npx wrangler versions upload --name muyrico --assets .` + `versions deploy`). Owner can then upload photos.
3. **Static pages**: `gallery.html`, `order.html`, `index.html` changes deploy with the same static-worker upload.

## Testing

- **API**: `wrangler dev -c orders/wrangler.toml` locally + curl: public `GET /api/gallery` without Access headers; POST/PATCH/DELETE rejected without auth (locally bypassed via `isLocal`).
- **Admin**: build, open `/admin/` locally, add/reorder/toggle/delete a photo, verify D1 rows.
- **Order page**: browser verification with Playwright (webapp-testing skill): pill filtering shows only matching tiles; counts correct; cart state preserved after filtering; deep-link scrolls, highlights, and the design note appears in the cart line.
- **Gallery page**: albums grouped correctly, Spanish toggle works, "Request this design" links carry correct `product`/`design` params; failure state renders when API is unreachable.
- **Bilingual**: all new UI strings have `data-es`/`data-en` (except category pill names, intentionally English-only per decision).

## Out of Scope (YAGNI)

- Lightbox/carousel on the order page
- Gallery photos without a linked product
- `category_es` column / translated category pills
- Bulk-reorder API endpoint; drag-drop reorder in admin
- Generalizing the R2 `products/` upload key prefix
- Any checkout/payment changes
