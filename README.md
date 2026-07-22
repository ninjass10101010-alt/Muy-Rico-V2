# Muy Rico — Authentic Mexican Bakery Website

Live website for **Muy Rico**, a family-owned Mexican bakery in Holland, Michigan.

## 📦 Tech Stack

- Static marketing site: HTML5 / CSS3 / Vanilla JS — "Editorial Panadería" design system (cream `#FAF6EC`, forest `#1E4636`, hairline borders, no gradients)
- [GSAP 3](https://gsap.com/) for scroll animations (fade + rise only; no infinite loops)
- Admin dashboard: React 19 + Vite + Tailwind 4 (single-file bundle)
- Backend: Cloudflare Workers + D1 (SQLite)
- Auth: Cloudflare Access (email + one-time PIN)
- Stripe Checkout for card payments
- PayPal Smart Buttons for Venmo/PayPal
- Google Fonts — Playfair Display & Figtree

## 📄 Pages

| URL | File | Description |
|---|---|---|
| `/` | `index.html` | Home — split editorial hero (dashboard-editable photo), "Del Horno" featured products, Our Story, testimonials (auto-shows when reviews are published), Visit (hours + Holland map), Cottage Food Law |
| `/order` (public); `/order.html` (legacy) | `order.html` | Order page — product menu w/ photos, cart, Formspree submission, Stripe + PayPal/Venmo payments |
| `/gallery.html` | `gallery.html` | Public photo albums grouped by product (from `/api/gallery`) |
| `/admin/` | `admin/index.html` (built from `home-bakery-management-system/`) | Owner dashboard — orders, products, inventory, customers, payments, labels, **homepage editor**, settings |
| `/admin/order/` | `admin/index.html` (built) | Public React order page (preview-only; legacy `order.html` is the live customer flow) |

## 🖼️ Images

| File | Usage |
|---|---|
| `hero-conchas.webp` | Hero default (overridable via dashboard → Homepage) |
| `story-rebecca-jeff.webp` | Our Story default portrait (overridable via dashboard) |
| `menu-*.webp` | Local fallback photos for the menu-preview strip & order tiles |
| `muy_rico_logo_transparent.webp` | Muy Rico logo |

## 🏠 Homepage editing (dashboard → Homepage)

The landing page ships with full baked-in defaults, then hydrates from the API — no redeploy needed to change content:

- **Photos** (`site_content` table): hero & story photo slots, uploaded to R2 via `/api/upload`
- **Visit & hours** (`site_content`): EN/ES text for hours, ordering lead times, pickup, contact
- **Testimonials** (`testimonials` table): EN/ES quotes with publish toggle; section auto-appears when ≥1 is published
- **"Del Horno" preview**: products flagged `featured` (checkbox in Menu & Products); falls back to first 4 products with photos
- **Public endpoint**: `GET /api/site` (content map + published testimonials); admin: `PUT /api/site`, testimonial CRUD under `/api/testimonials`
- Migration: `orders/migrations/0017_site_content.sql`

## ⚡ Performance

- All images converted to WebP with ~95% size reduction
- LCP hero preloaded with `fetchpriority="high"`
- Lazy loading on below-the-fold images
- Open Graph & Twitter Card meta tags for social sharing

## 📬 Ordering & Payments

Orders written to D1 via `/api/orders` POST. Customers can pay with:

- **Stripe** — Card, Apple Pay, Cash App Pay *(via `muy-rico-checkout` Worker)*
- **PayPal / Venmo** — PayPal Smart Buttons *(client-side)*

## 🚀 Deployment

This repo deploys to **Cloudflare** as three components:

### 1. Worker `muyrico` (Static Marketing + Admin SPA)
- Deployed as static assets using Workers Assets.
- **Build command**:
  ```bash
  cd home-bakery-management-system && npm run build && cd ..
  ```
- **Deploy command**:
  ```bash
  npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21
  npx wrangler versions deploy --name muyrico <VERSION_ID>@100%
  ```

### 2. Worker `muy-rico-orders-api` (D1-backed CRUD)
- Source: `orders/`
- **Deploy command**:
  ```bash
  npx wrangler deploy -c orders/wrangler.toml
  ```
- Run migrations (locally + remote):
  ```bash
  npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/NNNN_name.sql
  ```

### 3. Worker `muy-rico-checkout` (Stripe Checkout)
- Source: `workers/`
- **Deploy command**:
  ```bash
  cd workers && npx wrangler deploy && cd ..
  ```
- Set secret: `wrangler secret put STRIPE_SECRET_KEY`

### 4. Cloudflare Access (admin auth)
- Zero Trust → Access → Applications → Add
- **Type:** Self-hosted
- **Domain:** `muy-rico.com` (or `muy-rico.pages.dev`), **Path:** `/admin*`
- **Identity provider:** One-time PIN
- Allowlist emails: `jeffery.garcia1@icloud.com`, `bexgarcia0208@gmail.com`

## ⚖️ Legal

Operates under the **Michigan Cottage Food Law** (Public Act 51 of 2025).
