# Muy Rico — Authentic Mexican Bakery Website

Live website for **Muy Rico**, a family-owned Mexican bakery in Holland, Michigan.

## 📦 Tech Stack

- Pure HTML5 / CSS3 / Vanilla JS
- [GSAP 3](https://gsap.com/) for scroll animations
- [Google Fonts](https://fonts.google.com/) — Cormorant Garamond & Quicksand
- All images served as WebP (converted from PNG/JPG)

## 📄 Pages

| File | Description |
|---|---|
| `index.html` | Home page — hero, our story, community values, Cottage Food Law info |
| `order.html` | Order page — product menu, cart, Formspree submission, Stripe + PayPal/Venmo payments |
| `style.css` | All styles — design tokens, layout, components |

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

Orders are sent via **Formspree** to `bexgarcia0208@gmail.com`.  
Customers can pay with:

- **Stripe** — Card, Apple Pay, Cash App Pay *(via Netlify serverless function)*
- **PayPal / Venmo** — PayPal Smart Buttons *(client-side)*

## 🚀 Deployment (Cloudflare Pages)

1. Push this project to a GitHub repo
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages**
3. Connect your GitHub repo and deploy
4. Set environment variable in **Settings → Environment Variables**:
   - `STRIPE_SECRET_KEY` = your Stripe secret key
5. Find `YOUR_PAYPAL_CLIENT_ID` in `order.html` and replace with your PayPal Client ID from [developer.paypal.com](https://developer.paypal.com)
6. The checkout function runs at `/create-checkout` on your Pages domain

## 📁 Project Structure

| File | Description |
|---|---|
| `index.html` | Home page |
| `order.html` | Order page with cart, form, Stripe + PayPal/Venmo payments |
| `style.css` | All styles |
| `functions/create-checkout.js` | Cloudflare Pages Function — creates Stripe Checkout Sessions |

## ⚖️ Legal

Operates under the **Michigan Cottage Food Law** (Public Act 51 of 2025).
