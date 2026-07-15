# Muy Rico — Cloudflare Deployment Guide

This guide explains how to build and deploy both the backend API and the static frontend assets for the Muy Rico bakery website.

## 🚀 Deployed Architecture

The application is deployed on Cloudflare using the following components:
1. **`muyrico`** (Frontend): Serves static files (`index.html`, `order.html`, `style.css`, and the `admin/index.html` dashboard SPA) using Cloudflare Workers Assets.
2. **`muy-rico-orders-api`** (Backend API): A Cloudflare Worker under the `orders/` folder that connects to D1 Database (`muy-rico-orders`) and R2 Bucket (`muy-rico-product-images`).
3. **`muy-rico-checkout`** (Stripe Checkout): A Cloudflare Worker under the `workers/` folder that handles Stripe payments.

---

## 🛠️ Step-by-Step Deployment

To update the website and admin dashboard:

### Step 1: Build the Admin Dashboard React SPA
The owner dashboard lives in `home-bakery-management-system/`. You must compile it to a single file, which the postbuild script copies automatically to `admin/index.html`.
```bash
cd home-bakery-management-system
npm run build
cd ..
```

### Step 2: Upload and Deploy Frontend Assets
Use Cloudflare Workers Assets to deploy the frontend (including the compiled `admin/index.html`):
```bash
# 1. Upload assets to Cloudflare (this will output a Version ID)
npx wrangler versions upload --name muyrico --assets . --compatibility-date 2025-03-21

# 2. Deploy that Version ID to 100% of production traffic
npx wrangler versions deploy --name muyrico <VERSION_ID>@100%
```

### Step 3: Deploy the Backend API Worker (If modified)
If you made changes to the backend API in the `orders/` directory:
```bash
npx wrangler deploy -c orders/wrangler.toml
```

### Step 4: Deploy the Stripe Checkout Worker (If modified)
If you made changes to the Stripe integration in `workers/`:
```bash
cd workers
npx wrangler deploy
cd ..
```

---

## 🗄️ Database Migrations

If you add new migrations (e.g. `orders/migrations/0013_some_change.sql`), run them on the remote D1 database:
```bash
npx wrangler d1 execute muy-rico-orders -c orders/wrangler.toml --remote --file=orders/migrations/NNNN_name.sql
```
