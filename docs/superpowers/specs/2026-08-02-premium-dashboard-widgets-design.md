# Premium Dashboard Cards & Widgets (backend-correct revenue)

**Date:** 2026-08-02
**Scope:** Dashboard page (`home-bakery-management-system/src/pages/Dashboard.tsx`) + `StatCard` component. No backend/DB/API changes.

## Goal

Refresh the four existing dashboard rows with premium-bakery visual cards, fix revenue correctness (sum collected payments, not booked totals), and add trend affordances (sparkline + month-over-month deltas) and friendly empty states — without restructuring the layout.

## Background

The Dashboard renders four rows: hero banner, 7 stat cards, two charts (revenue bar + payment-mix pie), and two lists (orders needing attention + best sellers), plus a low-stock alert strip. The recent clear-indicators work (Orders page + Dashboard "Orders needing attention" panel) added `dueTier`/`urgencyRank` helpers and an attention list.

Two data-correctness problems exist today:

1. **"Revenue last 7 days" chart is wrong.** It sums `order.total` by `createdAt` regardless of payment status. A $200 unpaid pending order inflates the bar.
2. **`stats.revenueMonth`** (`Dashboard.tsx:41`) already sums payments — correct. But the chart and "Revenue" mental model disagree (chart = booked, card = collected).

This spec unifies everything on **collected payments** as the source of truth for revenue, while exposing a secondary "Booked this month" number for sanity-check parity.

## Design

### 1. Data layer correctness (Dashboard.tsx only)

All derivations remain in `useMemo` hooks inside `Dashboard.tsx`. No `StoreContext` or API changes.

- `last7days` chart: bucket by `p.date` from `payments`, summing `p.amount`. **Remove** the `order.total` accumulation from `orders.forEach`.
- `revenueMonth` (kept as-is): sum of `payments` with `p.date` in current calendar month.
- **New** `revenuePrevMonth`: sum of `payments` with `p.date` in prior calendar month. Used for the trend delta on the Revenue card.
- **New** `bookedMonth`: sum of `order.total` for orders with `createdAt` in current month. Used only for the hero "Booked this month" chip — a secondary, honestly-labeled number.
- `revenueSpark`: array of 7 collected-payment totals per day for the last 7 days (same data as `last7days`, reused).

Trend delta = `((revenueMonth - revenuePrevMonth) / max(1, revenuePrevMonth)) * 100`. Edge case: if `revenuePrevMonth === 0`, show no delta text (avoid infinity / awkward "∞%").

**Confirmed not-bugs (no change):**
- `owedTotal` already subtracts per-order paid amounts correctly (matches what `recordPayment` writes to D1: one row per inflow, with `amount = remaining` for partial balance collection).
- `avgOrder` ignoring payment status: acceptable. Label "Avg order value" stays — it measures order size, not collected revenue.

### 2. Visual direction — "Premium bakery"

Built on existing palette (forest `#1E4636`, cream `#FAF6EC`, hairline borders, serif headings). Card upgrades:

- `rounded-2xl` (16px) for the card, 8px for inner elements
- Soft layered shadow: `shadow-sm` plus custom `shadow-[0_8px_24px_-12px_rgba(30,70,54,0.18)]`
- Hover lift: `-translate-y-0.5` on hover; shadow intensifies (keep existing `hover:shadow-md` + `hover:-translate-y-0.5` already on `StatCard`)
- Accent left bar (existing) — keep
- Serif numeric value (existing) — keep; add small unit sublabel line below when provided

No new dependencies. All via Tailwind utility classes plus the existing `cn` helper.

### 3. Component changes

#### `src/components/ui/StatCard.tsx`

Extend without breaking existing callers. Add three optional props:

```ts
trend?: { pctDelta: number; spark?: number[] };
cta?: { label: string; onClick: () => void };
onClick?: () => void;
```

Behavior:
- If `trend.spark` provided and has ≥ 2 non-equal points, render an inline SVG sparkline (64×16 px) in the card tone color, positioned top-right of the value row. If < 2 points or all-equal, render nothing (no broken flat lines).
- If `trend.pctDelta` is non-zero and finite, render "▲ 12% vs last month" (green) or "▼ 3% vs last month" (red) under the value, replacing the existing `sub` line when both are provided (prefer `trend` over `sub`).
- If `cta` provided, render an inline-text button "label →" at the bottom of the card (used for empty states / "View X" affordances).
- If `onClick` provided, the whole card becomes a button (role=button, keyboard accessible) — for click-to-page navigation. Cursor-pointer and full-card hover.

Default appearance unchanged for cards that pass none of the new props (backward compatible with existing 7 call sites in `Dashboard.tsx`).

#### `src/pages/Dashboard.tsx`

**Row 1 — Hero banner**
Right side: add a small "Booked this month: $X" chip (muted sand-50/15 background, frosted). Place below or beside existing "View Orders" button. Keep button. Keep flour-dust texture and welcome line.

**Row 2 — Stat cards** (7 cards, enriched):

| Card | Value | Sublabel / trend |
|---|---|---|
| Revenue this month | `formatCurrency(stats.revenueMonth)` | `trend={{ pctDelta, spark: revenueSpark }}` |
| Awaiting payment | `formatCurrency(stats.owedTotal)` | `sub: "${count} order(s)"` |
| Due next 48h | `String(stats.due48h)` | `sub: "${today} today"` |
| Orders in progress | `String(stats.pendingOrders.length)` | (none) |
| Avg order value | `formatCurrency(stats.avgOrder)` | (none) |
| Low stock items | `String(stats.lowStock.length)` | `sub: "${critical} critical"` (count where `quantity <= 0`) — show "0 critical" when none |
| Cake Quotes pending | `String(stats.pendingQuotes)` | (none) |

Each card gets `onClick={() => setPage(...)}` mapping to the relevant page (orders → "orders"; awaiting/due → "orders"; low stock → "inventory"; quotes → "quotes"; revenue → "orders"; avg → "orders").

**Row 3 — Charts**
- Revenue chart title becomes "Revenue collected — last 7 days" (was "Revenue — last 7 days"). Y-axis auto-scales to collected totals.
- Bars keep coral; add a soft top-area gradient (`url(#revenueBarGradient)` defs with coral → coral-light at 0.6 opacity) and a `ReferenceLine` at the 7-day average (muted dashed `#c8a978`).
- Payment-mix pie: unchanged.

**Row 4 — Lists**
- "Orders needing attention" empty state: render `EmptyState`-style block with "All caught up ✓" headline + button "View all orders →" (`setPage("orders")`).
- "Best sellers" empty state (no sales): "No sales yet → Set up your menu" CTA `setPage("products")`. Keep existing "No sales yet." path replaced by this richer CTA.

**Row 5 — Low stock alert** (existing, enhanced)
Split into two tiers when both present:
- Critical: `quantity <= 0` — hibiscus pill with icon `AlertTriangle`
- Low: `quantity <= reorderLevel && quantity > 0` — amber/coral pill (current style)

Show header counts in each section title (e.g. "Critical (2)" / "Low (5)"). If only one tier has items, only that section renders. Hidden entirely when both empty (current behavior preserved).

### 4. Sparkline rendering

No new dependency. Inline SVG inside `StatCard.tsx`. Compute polyline from `number[]`:

```tsx
function Sparkline({ data, color, w = 64, h = 16 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  if (max === min) return null;  // flat line, hide
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min)) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

Color from existing `iconColors[tone]` lookup (already in `StatCard`).

### 5. Empty-state pattern

Inlined in `Dashboard.tsx` (no new file):

```tsx
function EmptyState({ message, cta }: { message: string; cta?: { label: string; onClick: () => void } }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-5 py-10 text-center">
      <p className="text-sm text-cocoa-muted">{message}</p>
      {cta && (
        <button onClick={cta.onClick} className="text-xs font-medium text-coral hover:underline">
          {cta.label} →
        </button>
      )}
    </div>
  );
}
```

Used in attention list and best-sellers list when empty.

### 6. Scope / out of scope

**In scope:** `src/components/ui/StatCard.tsx` (extend), `src/pages/Dashboard.tsx` (data fixes, card enrichment, empty states, sparkline, hero booked chip, low-stock tier split). Inline `Sparkline` + `EmptyState` helpers — kept in same files (no new source files).

**Out of scope:** Orders page (just did it), Payments page, Labels/LabelDesigner, hero banner full rewrite (only adds the booked chip), changing what `recordPayment` writes to D1 (already correct), new API endpoints, new npm dependencies, restructuring to bento layout.

### 7. Risk notes

- **Switching Revenue semantics to collected** changes the number owners are used to. Mitigations: hero "Booked this month" chip keeps the booked number visible; chart label explicitly says "collected". Worth flagging to the owner when it ships.
- Sparkline accuracy depends on the `payments` array; if no payments in 7 days, sparkline is hidden per the < 2 / all-equal rule.
- `StatCard` is used in 7 places — all in `Dashboard.tsx`. Backward-compatible extension verified by call-site audit; no other component imports it. (`Grep` confirmed.)
- Hover lift + sparkline both add subtle motion; reduce-motion respected via Tailwind's `motion-reduce:` not strictly wired here, but motion is minimal (transform only on hover). Acceptable for this dashboard.

### 8. Verification

```bash
cd home-bakery-management-system
npx tsc --noEmit        # expect no NEW errors beyond pre-existing set
npm run build          # vite build + postbuild
npm run test           # 91 existing tests still pass; no new tests required (UI visual only)
npm run dev            # smoke check; curl /src/pages/Dashboard.tsx returns 200
```

Visual verification: open `/admin/`, confirm (a) Revenue card shows sparkline + ▲/▼ delta; (b) chart Y-axis reflects collected payments, dashed average line visible; (c) hero chip shows "Booked this month"; (d) empty-state CTAs render when applicable; (e) low-stock alert splits critical vs low when both present; (f) click-to-navigate works on each card.
