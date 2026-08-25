# Dashboard Home Visual Polish — Spec + Implementation Plan

**Date:** 2025-08-25 · **Status:** Approved by owner (all P1+P2) · **Branch:** main

## Goal

Nine approved visual/a11y improvements to the dashboard home page. Presentational only — no data logic changes beyond derived display values.

## Global constraints

1. Work on main; surgical `git add` only listed files. No new dependencies. No backend changes.
2. Palette/radius/shadow tokens from `src/index.css` only. Test gates: SPA `npm test` 201 passed; `npx tsc --noEmit` zero NEW errors in touched files. No new tests (presentational; repo convention).
3. Files: `src/pages/Dashboard.tsx`, `src/components/DashboardUpcomingWidget.tsx`, `src/components/InventoryLowStockWidget.tsx`, rebuilt `admin/index.html`.

---

### Task 1 — Stat restructure + skeleton + banner greeting (Dashboard.tsx)

**Interfaces:** Produces local `MiniStat` component; `greeting` string. Consumes existing store stats.

- [ ] Step 1: Add above the component: nothing needed. Inside component after hooks add:
```tsx
  const nowHour = new Date().getHours();
  const greeting = nowHour < 12 ? "Buenos días" : nowHour < 19 ? "Buenas tardes" : "Buenas noches";
  const todayLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
```
- [ ] Step 2: Replace the loading spinner block with skeleton:
```tsx
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-32 animate-pulse rounded-xl bg-sand-200/50" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl border border-sand-200 bg-white" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-xl border border-sand-200 bg-white lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-xl border border-sand-200 bg-white" />
        </div>
        <div className="h-36 animate-pulse rounded-xl border border-sand-200 bg-white" />
      </div>
    );
  }
```
- [ ] Step 3: Banner copy — replace `<p ...>Bienvenidos de vuelta</p>` with `<p className="text-sm font-medium text-sand-50/80">{greeting} · {todayLabel}</p>`.
- [ ] Step 4: Stat restructure — primary grid becomes `grid-cols-2 sm:grid-cols-4` containing ONLY: Revenue this month / Awaiting payment / Due next 48h / Orders in progress. After that grid insert:
```tsx
      {/* Also tracking */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-sand-200 bg-white px-5 py-3 shadow-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-cocoa-muted/70">Also tracking</span>
        <MiniStat icon={TrendingUp} tone="text-coral" label="Avg order" value={formatCurrency(stats.avgOrder)} onClick={() => setPage("orders")} />
        <MiniStat icon={PackageX} tone="text-hibiscus" label={`Low stock${stats.lowStockCritical ? ` · ${stats.lowStockCritical} critical` : ""}`} value={String(stats.lowStock.length)} onClick={() => setPage("inventory")} />
        <MiniStat icon={MessageSquareQuote} tone="text-coral" label="Quotes pending" value={String(stats.pendingQuotes)} onClick={() => setPage("quotes")} />
      </div>
```
And define below the component's closing brace:
```tsx
function MiniStat({ icon: Icon, tone, label, value, onClick }: {
  icon: typeof TrendingUp; tone: string; label: string; value: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="group flex items-center gap-2 text-left transition hover:opacity-80 active:scale-[0.98]">
      <Icon size={14} className={tone} />
      <span className="text-xs text-cocoa-muted">{label}</span>
      <span className="font-serif text-lg font-semibold tabular-nums text-cocoa">{value}</span>
    </button>
  );
}
```
Remove the three old StatCard blocks (Avg order value, Low stock items, Cake Quotes pending). Delete now-unused imports if any (none expected — icons reused).

- [ ] Verify: tsc filtered `Dashboard.tsx` clean; npm test 201.
- [ ] Commit: `git add home-bakery-management-system/src/pages/Dashboard.tsx && git commit -m "feat(dashboard): hero stats + also-tracking strip, skeletons, greeting"`

### Task 2 — Chart upgrades (Dashboard.tsx)

- [ ] Step 1: last7days gains flag — push objects with `revenue: 0, isToday: i === 0`; keep rest.
- [ ] Step 2: Week total in header — replace revenue chart `<h3>` line block with:
```tsx
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="font-serif text-base font-semibold text-cocoa">Revenue collected — last 7 days</h3>
            <span className="text-xs text-cocoa-muted">
              <span className="font-semibold tabular-nums text-cocoa">{formatCurrency(last7days.reduce((s, d) => s + d.revenue, 0))}</span> this week
            </span>
          </div>
```
- [ ] Step 3: Today emphasis — delete the `<defs>` gradient block; replace `<Bar .../>` with:
```tsx
              <Bar dataKey="revenue" radius={[6, 6, 0, 0]}>
                {last7days.map((d) => (
                  <Cell key={d.label} fill={d.isToday ? "#e88a86" : "#f2cfc6"} />
                ))}
              </Bar>
```
- [ ] Step 4: y-axis money format — YAxis gains `tickFormatter={(v: number) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`)}`.
- [ ] Step 5: Donut center total + % legend — compute inside component before return of that card section: derive `const collectedTotal = paymentBreakdown.reduce((s, p) => s + p.value, 0);` (place near paymentBreakdown memo usage). Wrap the PieChart ResponsiveContainer in `<div className="relative">…</div>` and append sibling overlay:
```tsx
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-cocoa-muted/70">Collected</span>
                <span className="font-serif text-xl font-semibold tabular-nums text-cocoa">{formatCurrency(collectedTotal)}</span>
              </div>
```
Legend rows: after the amount span add `{collectedTotal > 0 && <span className="w-8 text-right text-cocoa-muted/70">{Math.round((p.value / collectedTotal) * 100)}%</span>}` and give the row `gap-2` layout (amount span gets `tabular-nums`). Also bump both chart card titles (`Revenue…` handled above; `Payment methods`) to `font-serif text-base font-semibold`.
- [ ] Verify + commit: message `feat(dashboard): chart upgrades — today emphasis, week total, donut center, % legend`

### Task 3 — Rows, widgets, typography polish

Files: Dashboard.tsx, DashboardUpcomingWidget.tsx, InventoryLowStockWidget.tsx

- [ ] Step 1: Best sellers bars — inside `bestSellers.map`, destructure max first: `const maxQty = Math.max(...bestSellers.map((b) => b.qty), 1);` Each item becomes:
```tsx
              <div key={product!.id} className="px-5 py-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-cocoa">
                    <ProductIcon emoji={product!.emoji} imageUrl={product!.image_url} size={28} /> {product!.name}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-cocoa-muted">{qty} sold</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sand-100">
                  <div className="h-full rounded-full bg-coral/70" style={{ width: `${Math.max(6, Math.round((qty / maxQty) * 100))}%` }} />
                </div>
              </div>
```
- [ ] Step 2: Attention rows accessibility + tooltips + numerals — change outer element from `<div key={o.id} onClick=…>` to `<button type="button" onClick={() => setPage("orders")} className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-sand-50 active:scale-[0.99]">`; payment icons get `title` attrs: paid `"Paid in full"`, partial `"Partial payment"`, unpaid `"Payment outstanding"`; amount span adds `tabular-nums`.
- [ ] Step 3: Press feedback — Upcoming widget rows + LowStock rows: add `active:scale-[0.99]` to their interactive row classNames (upcoming rows are already buttons).
- [ ] Step 4: Title bump — every dashboard card/widget header using `font-serif text-sm font-semibold` becomes `font-serif text-base font-semibold` (Dashboard ×4 incl. Payment methods handled in Task 2, Upcoming reminders, Low stock, Orders needing attention, Best sellers).
- [ ] Verify + commit: `polish(dashboard): accessible rows, tooltips, tabular nums, seller bars, title scale`

### Task 4 — Controller: build, deploy, verify, push

- [ ] `npm run build`; grep live strings; commit bundle `chore(admin): rebuild bundle — dashboard visual polish`
- [ ] Assets-only deploy (`versions upload` + `deploy @100%`; worker unchanged); hash-compare live vs local admin/index.html
- [ ] Push origin; update SDD ledger
