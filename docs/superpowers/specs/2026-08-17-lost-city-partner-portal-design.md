# The Lost City Partner Portal — Design

**Date:** 2026-08-17
**Status:** Design validated via mockups; implementation paused (not to be deployed yet)

## Purpose

Private B2B ordering portal for **The Lost City** (arcade + laser tag business, Holland MI) to order custom cakes and cupcakes from Muy Rico. The portal must feel like *their* business (GI Joe / arcade / neon laser-tag / jungle-tiki aesthetic) while orders flow into Muy Rico's existing admin dashboard.

## Decisions (from client Q&A)

| Topic | Decision |
|---|---|
| Ordering flow | Direct order + pay at checkout (Stripe/PayPal), same as public flow |
| Users | One contact person (Cloudflare Access email + one-time PIN, same pattern as `/admin`) |
| Pricing | Fixed partner packages with small options. Package set/prices are being developed separately by the client — portal supports whatever catalog is configured |
| Calendar | Shows their order/pickup dates + date picker with lead-time rules (min 7 days, closed Sundays) |
| Portal URL | Subdomain: `lostcity.muy-rico.com` |
| Theme | "NEON RUINS" — dark bunker + laser neon, Aztec step trim, monstera accents |
| Receipts | Downloadable receipts per paid order for their records |
| Order visibility | All partner orders appear in Muy Rico's existing admin dashboard (flagged as partner) |

## Theme — NEON RUINS (validated through mockup iterations v1–v6)

- **Base:** near-black `#0a0a11`, panels `#10101a`, borders `#23233a`
- **Neon accents:** laser red `#ff2e4d`, electric cyan `#21e6ff`, magenta `#e86cff`, gold `#EDAA31`
- **Trim:** Aztec step-pattern strip under header — **magenta** on dark (client request)
- **Fonts:** Chakra Petch (UI), Oswald (display headers)
- **Logo:** The Lost City's real logo — background stripped, letters inverted to white with red neon glow, large in the header (asset saved at `docs/partner-portal/assets/tlc-letters.png`)
- **Decoration:** monstera leaf line-art (existing repo asset), Aztec trim, glow effects via box-shadow/text-shadow
- **Language:** mission/ops vocabulary ("Mission Control", "Submit Mission", "Missions Logged")

## Screens

1. **Mission Control** — stats (next pickup, open orders, YTD spend), quick-reorder panel, active missions table, mini pickup calendar, latest receipts
2. **Place Order** — package cards (name, description, price, option chips), pickup date picker (7-day min lead), total, Submit Mission
3. **Calendar** — month grid: pickups glow red, delivered green, today cyan, Sundays closed; click an open day → prefill order form with that date; upcoming pickups list
4. **Order History** — filter chips (All/Confirmed/In Production/Awaiting/Delivered), reorder buttons per row
5. **Receipts** — YTD spend + last-30-days stats, receipt list with download

Interactive mockup saved at `docs/partner-portal/lost-city-mockup.html` (open locally to view; nav/filters/package selection are wired).

## Architecture — Approach (recommended: A)

**A. Extend existing stack (recommended)**
- New static SPA (`partner/` folder, plain HTML/CSS/JS like the public site — no build step needed for v1) deployed as Workers Assets on the `muyrico` worker, routed at `lostcity.muy-rico.com`
- Extend `muy-rico-orders-api` (orders/workers/api.js, D1): new `partners` + `partner_packages` tables, partner-scoped endpoints (`/api/partner/...`), order rows get `partner_id` + `source='partner'`
- Auth: Cloudflare Access application for `lostcity.muy-rico.com/*`, allowlist their email; same PIN flow as `/admin`
- Payments: reuse existing Stripe/PayPal checkout paths
- Admin: existing React dashboard gets a partner filter/flag on orders; partner packages managed under Products

**B. Separate partner portal Workers project** — cleaner isolation but duplicates deploy config, CORS, auth, and payment wiring. Not worth it for one partner.

**C. Off-the-shelf SaaS (e.g., wholesale portal services)** — no code but off-brand, monthly cost, no custom theming to match The Lost City.

## Data model sketch (D1)

```sql
partners(id, name, slug, contact_email, active)
partner_packages(id, partner_id, name, description, price_cents, options_json, active, sort)
-- orders: add partner_id NULL FK + source ('public' | 'partner')
-- receipts: existing table, filtered by partner via order_id
```

## Out of scope (v1)

- Multiple partners / self-serve signup (invite-code auth) — architecture allows it later
- Availability/booking-capacity blocks on the calendar
- Custom cake request/quote form inside the portal (packages cover ordering; quote flow exists publicly)
- Net-30 invoicing / deposits — direct payment only
- Arcade drop-off scheduling logic (display note only)

## Next steps (when client resumes)

1. Finalize package catalog + prices with client
2. writing-plans skill → implementation plan (DB migration, API endpoints, portal SPA, Access config, admin flags, payments, deploy)
3. Deploy only when client approves going live
