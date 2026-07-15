# Muy Rico — Authentic Mexican Bakery Website

Live website for **Muy Rico**, a family-owned Mexican bakery in Holland, Michigan.

## 📦 Tech Stack

- Static marketing site: HTML5 / CSS3 / Vanilla JS
- [GSAP 3](https://gsap.com/) for scroll animations
- Admin dashboard: React 19 + Vite + Tailwind 4 (single-file bundle)
- Backend: Cloudflare Workers + D1 (SQLite)
- Auth: Cloudflare Access (email + one-time PIN)
- Stripe Checkout for card payments
- PayPal Smart Buttons for Venmo/PayPal
- Google Fonts — Cormorant Garamond & Quicksand

## 📄 Pages

| URL | File | Description |
|---|---|---|
| `/` | `index.html` | Home — hero, our story, community values, Cottage Food Law info |
| `/order` (public); `/order.html` (legacy) | `order.html` | Order page — product menu, cart, Formspree submission, Stripe + PayPal/Venmo payments |
| `/admin/` | `admin/index.html` (built from `home-bakery-management-system/`) | Owner dashboard — orders, products, inventory, customers, payments, labels, settings |
| `/admin/order/` | `admin/index.html` (built) | Public React order page (preview-only; legacy `order.html` is the live customer flow) |

## 🖼️ Images

| File | Usage |
|---|---|
| `IMG_0264.webp` | Hero background image |
| `muy_rico_logo_transparent.webp` | Muy Rico logo |
| `Rebecca_Jeff.webp` | Our Story portrait photo |

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
