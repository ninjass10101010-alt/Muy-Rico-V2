# Muy Rico — "Editorial Panadería" Premium Redesign

**Date:** 2026-07-21
**Status:** Approved by owner, in implementation

## Goal

Elevate muy-rico.com from "handmade template" to a premium, editorial, organic design — as if produced by an experienced web designer — while keeping the brand's bilingual warmth, logo, and all e-commerce functionality. All three public pages (index, order, gallery) get the new system. The admin dashboard becomes the true content editor for photos, testimonials, visit info, and homepage product featuring.

## Design system

| Token | Value | Role |
|---|---|---|
| `--cream` | `#FAF6EC` | Page background |
| `--cream-deep` | `#F2ECDD` | Alternating section bands |
| `--forest` | `#1E4636` | Primary ink, headlines, buttons |
| `--forest-soft` | `#43685A` | Secondary text, captions |
| `--clay` | `#BC5548` | Sparing accent (hover, small ornaments, prices) |
| `--hairline` | `rgba(30,70,54,0.16)` | All borders/dividers |
| `--paper` | `#FFFDF7` | Card surfaces |

- **Type:** Playfair Display (400/500/600 + italics) display; Figtree (400/500/600/700) body/UI. Fluid `clamp()` scale. Nothing below 0.72rem.
- **Surfaces:** flat, 1px hairlines, ≤14px radius, shadows eliminated except floating cart.
- **Signature moves:** (1) bilingual layering — Spanish Playfair italic large + English letterspaced small caps beneath; (2) one engraved line-art monstera used with discipline; (3) museum-label photography — fixed aspect ratios, hairline frames, serif italic captions.
- **Motion:** one hero entrance; scroll reveals fade+20px; no infinite loops; `prefers-reduced-motion` respected.

## Page structure (index.html)

1. Masthead (replaces 280px sidebar): logo left, nav, ES/EN toggle, forest "Order Online" button; mobile = refined existing header+drawer pattern.
2. Hero: split editorial — copy left, 4:5 framed conchas photo right (dashboard-editable, local `hero-conchas.webp` default).
3. "Del Horno / From the Oven": 4 featured products from `/api/products` (featured flag), baked-in defaults using local photos; mobile snap-scroll strip.
4. Nuestra Historia: `story-rebecca-jeff.webp` framed + edited copy (~40% tighter) + pull-quote.
5. Testimonials: auto-hidden until ≥1 published testimonial from `/api/site`.
6. Visítanos: hours/lead-time/pickup text (dashboard-editable, EN/ES) + Google Maps embed centered on Holland, MI (no home address).
7. Cottage Food Law: condensed quiet half-page.
8. Forest CTA band + calm footer. Favicon: "MR" monogram SVG.

Removed: wave dividers, glass blur, gradient/pulse buttons, emoji decoration, blob radii, beach hero, "patience while we build" copy, inline style attributes, sidebar, IMG_0264 beach preload.

## Dashboard-as-editor

- **D1 migration** (`orders/migrations/0004_site_content.sql`): `site_content` (key PK, value_en, value_es, image_url, updated_at), `testimonials` (id, quote_en, quote_es, author, occasion, published, display_order, timestamps), `ALTER TABLE products ADD featured INTEGER DEFAULT 0`.
- **API** (`orders/workers/api.js`): public `GET /api/site` (content map + published testimonials); auth `PUT /api/site/content`, testimonial CRUD; products accept `featured`.
- **Admin** (`home-bakery-management-system/`): new "Homepage" page — photo slots (upload via existing `/api/upload`), visit/hours EN/ES fields, testimonials manager; "Featured on homepage" checkbox in Products.
- **Hydration:** index.html ships with full baked-in defaults (SEO + outage resilience); JS fetches `/api/site` and `/api/products` and overlays; language toggle translates hydrated content (pattern from gallery.html).

## Responsive

Fluid type; hero stacks photo-first on mobile; menu snap-strip; full-width 4:3 map; `object-fit: cover` fixed-ratio containers so any dashboard upload renders correctly; ≥44px touch targets; verified at 360/390/768/1024/1440px via Playwright screenshots.

## Out of scope

Changes to order/Stripe/PayPal JS logic; admin rebuild beyond the new page + checkbox; deploying to production (owner runs documented deploy commands).
