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

This repo deploys to **Cloudflare** as four pieces:

### 1. Pages project `muy-rico` (marketing + admin SPA)
- Cloudflare Dashboard → **Workers & Pages** → **Pages** → your project
- **Root directory:** repo root
- **Build command:** `cd home-bakery-management-system && npm ci && npm run build`
- **Build output directory:** `/` (repo root — Pages serves whatever ends up here)
- The build copies the SPA's bundled `dist/index.html` → `../admin/index.html`, served at `muy-rico.pages.dev/admin/`
- Set env var: `STRIPE_SECRET_KEY` is **not** needed here — Stripe is its own Worker

### 2. Worker `muy-rico-orders-api` (D1-backed CRUD)
- Source: `orders/`
- Deploy: `npm --prefix orders run deploy` (or `cd orders && npx wrangler deploy`)
- After first-time setup: `npx wrangler d1 create muy-rico-orders`, copy `database_id` into `orders/wrangler.toml`
- Run pending migrations locally + remote:
  ```bash
  npx wrangler d1 execute muy-rico-orders --file=migrations/NNNN_*.sql
  npx wrangler d1 execute muy-rico-orders --remote --file=migrations/NNNN_*.sql
  ```

### 3. Worker `muy-rico-checkout` (Stripe Checkout)
- Source: `workers/`
- Deploy: `cd workers && npx wrangler deploy`
- Set secret: `wrangler secret put STRIPE_SECRET_KEY`

### 4. Cloudflare Access (admin auth)
- Zero Trust → Access → Applications → Add
- **Type:** Self-hosted
- **Domain:** `muy-rico.pages.dev`, **Path:** `/admin*`
- **Identity provider:** One-time PIN
- Allowlist emails: `jeffery.garcia1@icloud.com`, `bexgarcia0208@gmail.com`

### 5. Route the API to the Pages domain
- Workers → Routes → Add
- **Route:** `muy-rico.pages.dev/api/*`
- **Worker:** `muy-rico-orders-api`
- This lets the SPA and `order.html` use relative `/api/...` paths; the Worker's cf-access-authenticated-user-email header applies uniformly.

## ⚖️ Legal

Operates under the **Michigan Cottage Food Law** (Public Act 51 of 2025).
