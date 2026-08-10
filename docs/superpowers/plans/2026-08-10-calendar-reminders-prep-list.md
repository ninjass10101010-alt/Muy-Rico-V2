# Calendar, Reminders & Prep List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an integrated Calendar page (Month/Week/Day/List views), in-app reminder bell with snooze/dismiss, and an aggregate ingredient prep list bridged to the Inventory page.

**Architecture:** Pure client-side (Approach A). Reads existing `StoreContext` data (`orders`, `products`, `inventory`, `profile`). All computation lives in pure util functions with unit tests. Reminder config + snooze state persist in `localStorage`. No backend changes, no migrations, no new API endpoints.

**Tech Stack:** React 19, Vite 7, Tailwind 4, TypeScript, vitest + jsdom (test env), lucide-react icons.

## Global Constraints

1. **No backend changes.** Do NOT modify `orders/workers/api.js`, `workers/checkout.js`, or any D1 migration. The `business_profile` table has no `reminders` column and the worker whitelists `PROFILE_FIELDS` — the server will silently drop a `reminders` field from `PUT /api/profile`.
2. **Reminder config persistence = localStorage** under key `muyrico:reminderConfig`, merged over `profile.reminders` (which the server drops). Snooze/dismiss state under key `muyrico:reminders`. This honors the spec's "no backend changes"; a D1 column is a follow-up, NOT in this plan.
3. **`BusinessProfile` is currently MISSING from `src/types.ts`** — it is imported by many files and produces pre-existing `tsc` errors (TS2305). Task 1 defines it. This is a prerequisite, not scope creep.
4. **`tsc --noEmit` is NOT a gate** — the repo has many pre-existing errors (`defaultElements.ts`, `NutritionFactsPanel.tsx`, etc.). Gates are: `npm test` (vitest) and `npm run build` (vite build, esbuild).
5. **Pack-size orders:** `OrderItem.qty` = number of packs (e.g. `qty: 1` = one 12-count pack). Pack multiplier resolved by matching `OrderItem.price` to `Product.pack_sizes[].price` (pack id is not recorded on the item). Documented limitation: if two packs share a price, the first match wins.
6. **Dates:** `Order.dueDate` is an ISO string. Day matching uses `dueDate.slice(0, 10)` (local date part) compared lexicographically — timezone-safe, no `new Date()` rounding bugs.
7. **All paths below** are relative to `home-bakery-management-system/` unless absolute.
8. **Commands:** run in `home-bakery-management-system/`. Test: `npm test`. Build: `npm run build`. Dev server: `npm run dev` (port 5173).

---

### Task 1: Define `BusinessProfile` + `ReminderConfig` types and defaults

Fixes the pre-existing missing type and adds the reminder config shape. No UI yet.

**Files:**
- Modify: `src/types.ts` (append at end)
- Modify: `src/data/seedData.ts` (seedProfile + import)
- Test: none (type-level; verified with targeted tsc check)

**Interfaces:**
- Produces: `interface ReminderConfig`, `interface BusinessProfile`, `const DEFAULT_REMINDER_CONFIG: ReminderConfig` (all exported from `src/types.ts`). Later tasks consume these exact names.

- [ ] **Step 1: Append types to `src/types.ts`**

```ts
// ─── Reminders / calendar config ─────────────────────────────────────────────

export interface ReminderConfig {
  leadDays: number;
  dayOf: boolean;
  defaultSnoozeHours: number;
  dayStartTime: number;
  dayEndTime: number;
}

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  leadDays: 2,
  dayOf: true,
  defaultSnoozeHours: 24,
  dayStartTime: 9,
  dayEndTime: 19,
};

export interface BusinessProfile {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  registrationNumber: string;
  businessType: "cottage" | "licensed";
  acceptedMethods: Record<PaymentMethod, boolean>;
  cashtag: string;
  venmoHandle: string;
  applePayEnabled: boolean;
  stripeConnected: boolean;
  reminders: ReminderConfig;
}
```

`DEFAULT_REMINDER_CONFIG` intentionally lives in `types.ts` (not `utils/`) to avoid a circular import (`utils/reminders.ts` imports types; seedData imports the constant).

- [ ] **Step 2: Add `reminders` to `seedProfile` in `src/data/seedData.ts`**

Add `DEFAULT_REMINDER_CONFIG` to the existing import from `../types` (line 2–10), then add the field to `seedProfile`:

```ts
export const seedProfile: BusinessProfile = {
  name: "Muy Rico",
  tagline: "Familia · Tradición · Sabor",
  address: "Holland, MI",
  phone: "(616) 218-3582",
  email: "hello@muy-rico.com",
  website: "https://muy-rico.com",
  registrationNumber: "",
  businessType: "cottage",
  acceptedMethods: { stripe: false, paypal: false, cashapp: true, venmo: true, applepay: true, cash: true },
  cashtag: "$MuyRicoBakery",
  venmoHandle: "@Muy-Rico",
  applePayEnabled: true,
  stripeConnected: false,
  reminders: DEFAULT_REMINDER_CONFIG,
};
```

- [ ] **Step 3: Verify the targeted type errors are gone**

Run: `npx tsc --noEmit 2>&1 | grep -c "BusinessProfile"` and `npx tsc --noEmit 2>&1 | grep "TS2305" | wc -l`
Expected: the `BusinessProfile` TS2305 count drops from 6 to 0. (Other pre-existing errors may remain — that's expected, constraint 4.)

- [ ] **Step 4: Run existing test suite to confirm nothing broke**

Run: `npm test`
Expected: all existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/data/seedData.ts
git commit -m "feat(calendar): define BusinessProfile + ReminderConfig types

BusinessProfile was imported across the app but never defined in
types.ts (pre-existing TS2305 errors). Define it plus the reminder
config shape and defaults. No backend changes; config persists via
localStorage per plan constraint 2."
```

---

### Task 2: `computeReminders` pure util + unit tests

The heart of the reminder tiers. Pure function, TDD.

**Files:**
- Create: `src/utils/reminders.ts`
- Create: `src/utils/reminders.test.ts`

**Interfaces:**
- Consumes: `Order`, `ReminderConfig`, `DEFAULT_REMINDER_CONFIG` from `src/types.ts`; `dueTier` from `src/utils/format.ts`.
- Produces:
  - `type ReminderTier = "overdue" | "today" | "tomorrow" | "leadDays" | "dismissed"`
  - `interface Reminder { order: Order; tier: ReminderTier; dueDate: string }`
  - `interface DismissState { dismissedAt: string; snoozedUntil: string | null }`
  - `function computeReminders(orders: Order[], config: ReminderConfig, now?: Date): Reminder[]`
  - `function isSnoozed(d: DismissState, now?: Date): boolean`
  - `function isDismissedToday(d: DismissState, now?: Date): boolean`
  - `function loadDismissMap(): Record<string, DismissState>`
  - `function saveDismissMap(map: Record<string, DismissState>): void`
  - `function loadReminderConfig(profileReminders?: ReminderConfig): ReminderConfig`
  - `function saveReminderConfigToLocal(config: ReminderConfig): void`

- [ ] **Step 1: Write the failing test file `src/utils/reminders.test.ts`**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { DEFAULT_REMINDER_CONFIG } from "../types";
import {
  computeReminders,
  isSnoozed,
  isDismissedToday,
  loadDismissMap,
  saveDismissMap,
  loadReminderConfig,
  saveReminderConfigToLocal,
} from "./reminders";
import type { Order } from "../types";

function mkOrder(partial: Partial<Order>): Order {
  return {
    id: "1",
    orderNumber: "MR-1",
    customerId: null,
    customerName: "Test",
    phone: "",
    items: [],
    source: "website",
    status: "pending",
    paymentMethod: null,
    paymentSubMethod: null,
    paymentStatus: "unpaid",
    subtotal: 0,
    discount: 0,
    total: 0,
    dueDate: "2026-06-11T10:00:00.000Z",
    createdAt: "2026-06-01T00:00:00.000Z",
    notes: "",
    inventoryDeducted: false,
    foodColoring: null,
    ...partial,
  };
}

const cfg = DEFAULT_REMINDER_CONFIG;

function iso(daysFromNow: number, hour = 10): string {
  const d = new Date("2026-06-11T00:00:00.000Z");
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

describe("computeReminders", () => {
  it("flags overdue orders", () => {
    const r = computeReminders([mkOrder({ dueDate: iso(-2) })], cfg, new Date("2026-06-11T08:00:00Z"));
    expect(r).toHaveLength(1);
    expect(r[0].tier).toBe("overdue");
  });

  it("flags today when dayOf is true", () => {
    const r = computeReminders([mkOrder({ dueDate: iso(0) })], cfg, new Date("2026-06-11T08:00:00Z"));
    expect(r[0].tier).toBe("today");
  });

  it("hides today when dayOf is false", () => {
    const r = computeReminders([mkOrder({ dueDate: iso(0) })], { ...cfg, dayOf: false }, new Date("2026-06-11T08:00:00Z"));
    expect(r).toHaveLength(0);
  });

  it("flags tomorrow", () => {
    const r = computeReminders([mkOrder({ dueDate: iso(1) })], cfg, new Date("2026-06-11T08:00:00Z"));
    expect(r[0].tier).toBe("tomorrow");
  });

  it("flags leadDays within the configured window", () => {
    const r = computeReminders([mkOrder({ dueDate: iso(2) })], cfg, new Date("2026-06-11T08:00:00Z"));
    expect(r[0].tier).toBe("leadDays");
  });

  it("does not flag orders beyond leadDays", () => {
    const r = computeReminders([mkOrder({ dueDate: iso(3) })], cfg, new Date("2026-06-11T08:00:00Z"));
    expect(r).toHaveLength(0);
  });

  it("excludes completed and cancelled orders", () => {
    const r = computeReminders(
      [mkOrder({ status: "completed", dueDate: iso(-1) }), mkOrder({ status: "cancelled", dueDate: iso(0) })],
      cfg,
      new Date("2026-06-11T08:00:00Z"),
    );
    expect(r).toHaveLength(0);
  });

  it("sorts overdue → today → tomorrow → leadDays", () => {
    const r = computeReminders(
      [
        mkOrder({ id: "lead", dueDate: iso(2) }),
        mkOrder({ id: "od", dueDate: iso(-1) }),
        mkOrder({ id: "tom", dueDate: iso(1) }),
        mkOrder({ id: "tod", dueDate: iso(0) }),
      ],
      cfg,
      new Date("2026-06-11T08:00:00Z"),
    );
    expect(r.map((x) => x.order.id)).toEqual(["od", "tod", "tom", "lead"]);
  });

  it("returns empty for empty orders", () => {
    expect(computeReminders([], cfg, new Date("2026-06-11T08:00:00Z"))).toEqual([]);
  });
});

describe("snooze / dismiss helpers", () => {
  const now = new Date("2026-06-11T08:00:00Z");

  it("isSnoozed true while snoozedUntil is in the future", () => {
    const d: DismissState = { dismissedAt: now.toISOString(), snoozedUntil: new Date(now.getTime() + 60_000).toISOString() };
    expect(isSnoozed(d, now)).toBe(true);
  });

  it("isSnoozed false after snooze expiry", () => {
    const d: DismissState = { dismissedAt: now.toISOString(), snoozedUntil: new Date(now.getTime() - 60_000).toISOString() };
    expect(isSnoozed(d, now)).toBe(false);
  });

  it("isDismissedToday true for same-day dismissal", () => {
    const d: DismissState = { dismissedAt: now.toISOString(), snoozedUntil: null };
    expect(isDismissedToday(d, now)).toBe(true);
  });

  it("isDismissedToday false for a prior-day dismissal (re-fires)", () => {
    const yesterday = new Date(now.getTime() - 86_400_000).toISOString();
    const d: DismissState = { dismissedAt: yesterday, snoozedUntil: null };
    expect(isDismissedToday(d, now)).toBe(false);
  });
});

describe("localStorage persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the dismiss map", () => {
    saveDismissMap({ "1": { dismissedAt: "x", snoozedUntil: null } });
    expect(loadDismissMap()).toEqual({ "1": { dismissedAt: "x", snoozedUntil: null } });
  });

  it("loads an empty map when nothing stored", () => {
    expect(loadDismissMap()).toEqual({});
  });

  it("round-trips reminder config", () => {
    saveReminderConfigToLocal({ ...cfg, leadDays: 5 });
    expect(loadReminderConfig()).toEqual({ ...cfg, leadDays: 5 });
  });

  it("loads defaults when nothing stored", () => {
    expect(loadReminderConfig()).toEqual(DEFAULT_REMINDER_CONFIG);
  });

  it("profile reminders lose to localStorage when both exist", () => {
    saveReminderConfigToLocal({ ...cfg, leadDays: 7 });
    expect(loadReminderConfig({ ...cfg, leadDays: 3 }).leadDays).toBe(7);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/utils/reminders.test.ts`
Expected: FAIL — `Cannot find module './reminders'`.

- [ ] **Step 3: Write minimal implementation `src/utils/reminders.ts`**

```ts
import { DEFAULT_REMINDER_CONFIG } from "../types";
import type { Order, ReminderConfig } from "../types";
import { dueTier } from "./format";

export type ReminderTier = "overdue" | "today" | "tomorrow" | "leadDays" | "dismissed";

export interface Reminder {
  order: Order;
  tier: ReminderTier;
  dueDate: string;
}

export interface DismissState {
  dismissedAt: string;
  snoozedUntil: string | null;
}

const LOCAL_DISMISS_KEY = "muyrico:reminders";
const LOCAL_CONFIG_KEY = "muyrico:reminderConfig";

export function computeReminders(orders: Order[], config: ReminderConfig, now = new Date()): Reminder[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const res: Reminder[] = [];
  for (const o of orders) {
    if (o.status === "completed" || o.status === "cancelled") continue;
    const tier = dueTier(o.dueDate, o.status);
    if (tier === "overdue") {
      res.push({ order: o, tier: "overdue", dueDate: o.dueDate });
    } else if (tier === "today") {
      if (config.dayOf) res.push({ order: o, tier: "today", dueDate: o.dueDate });
    } else if (tier === "tomorrow") {
      res.push({ order: o, tier: "tomorrow", dueDate: o.dueDate });
    } else if (tier === "this-week") {
      const due = new Date(o.dueDate);
      if (!Number.isNaN(due.getTime())) {
        const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
        if (diffDays >= 2 && diffDays <= config.leadDays) {
          res.push({ order: o, tier: "leadDays", dueDate: o.dueDate });
        }
      }
    }
  }
  const tierRank: Record<ReminderTier, number> = { overdue: 0, today: 1, tomorrow: 2, leadDays: 3, dismissed: 4 };
  return res.sort((a, b) => tierRank[a.tier] - tierRank[b.tier]);
}

export function isSnoozed(d: DismissState, now = new Date()): boolean {
  return !!d.snoozedUntil && new Date(d.snoozedUntil).getTime() > now.getTime();
}

export function isDismissedToday(d: DismissState, now = new Date()): boolean {
  if (!d.dismissedAt) return false;
  const dDate = new Date(d.dismissedAt);
  return (
    dDate.getFullYear() === now.getFullYear() &&
    dDate.getMonth() === now.getMonth() &&
    dDate.getDate() === now.getDate()
  );
}

export function loadDismissMap(): Record<string, DismissState> {
  try {
    const raw = localStorage.getItem(LOCAL_DISMISS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DismissState>) : {};
  } catch {
    return {};
  }
}

export function saveDismissMap(map: Record<string, DismissState>): void {
  localStorage.setItem(LOCAL_DISMISS_KEY, JSON.stringify(map));
}

export function loadReminderConfig(profileReminders?: ReminderConfig): ReminderConfig {
  let local: Partial<ReminderConfig> = {};
  try {
    const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
    if (raw) local = JSON.parse(raw) as Partial<ReminderConfig>;
  } catch {
    local = {};
  }
  return { ...DEFAULT_REMINDER_CONFIG, ...(profileReminders ?? {}), ...local };
}

export function saveReminderConfigToLocal(config: ReminderConfig): void {
  localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/utils/reminders.test.ts`
Expected: all PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/reminders.ts src/utils/reminders.test.ts
git commit -m "feat(calendar): computeReminders tiers + localStorage persistence"
```

---

### Task 3: `computePrepList` pure util + unit tests

Aggregates ingredient demand for a date window vs. current inventory.

**Files:**
- Create: `src/utils/prepList.ts`
- Create: `src/utils/prepList.test.ts`

**Interfaces:**
- Consumes: `Order`, `Product`, `InventoryItem` from `src/types.ts`.
- Produces:
  - `interface PrepNeed { inventoryItemId: string; name: string; unit: string; need: number; have: number; short: number; ok: boolean; inactive: boolean; orderIds: string[] }`
  - `interface PrepLineWithoutRecipe { productId: string; productName: string; qty: number }`
  - `interface PrepListResult { windowStart: string; windowEnd: string; needs: PrepNeed[]; withoutRecipe: PrepLineWithoutRecipe[]; ordersCovered: Order[] }`
  - `function computePrepList(orders: Order[], products: Product[], inventory: InventoryItem[], windowStart: string, windowEnd: string): PrepListResult`
  - `function packMultiplierFor(orderItem: { price: number }, product: Product): number`

- [ ] **Step 1: Write the failing test file `src/utils/prepList.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { computePrepList, packMultiplierFor } from "./prepList";
import type { InventoryItem, Order, Product } from "../types";

const flour: InventoryItem = { id: "inv-flour", name: "Flour (AP)", category: "Dry Goods", quantity: 6, unit: "cup", reorderLevel: 5, costPerUnit: 1, supplier: "", active: true };
const eggs: InventoryItem = { id: "inv-eggs", name: "Eggs", category: "Dairy", quantity: 24, unit: "each", reorderLevel: 10, costPerUnit: 0.3, supplier: "", active: true };
const retired: InventoryItem = { id: "inv-ret", name: "Retired Butter", category: "Dairy", quantity: 0, unit: "lb", reorderLevel: 1, costPerUnit: 1, supplier: "", active: false };

const conchas: Product = {
  id: "prod-conchas", name: "Conchas", category: "Pan", price: 2, cost: 1, sku: "C", emoji: "🍞", active: true,
  description: "", ingredients: "", allergens: "",
  recipe: [
    { inventoryItemId: "inv-flour", qtyPerUnit: 1.5 },
    { inventoryItemId: "inv-eggs", qtyPerUnit: 1 },
  ],
};

const cupcake: Product = {
  id: "prod-cup", name: "Cupcakes", category: "Postres", price: 3, cost: 1, sku: "CU", emoji: "🧁", active: true,
  description: "", ingredients: "", allergens: "",
  recipe: [{ inventoryItemId: "inv-flour", qtyPerUnit: 0.5 }],
  pack_sizes: [
    { id: "ps6", label: "6-pack", qty: 6, price: 15 },
    { id: "ps12", label: "12-pack", qty: 12, price: 28 },
  ],
};

const noRecipe: Product = {
  id: "prod-norecipe", name: "Custom Cake", category: "Cake", price: 50, cost: 10, sku: "CC", emoji: "🎂", active: true,
  description: "", ingredients: "", allergens: "", recipe: [],
};

const noProduct: Product = { ...conchas, id: "prod-other", name: "Other", sku: "O" };

function mkOrder(partial: Partial<Order>): Order {
  return {
    id: "1", orderNumber: "MR-1", customerId: null, customerName: "Test", phone: "", items: [],
    source: "website", status: "pending", paymentMethod: null, paymentSubMethod: null, paymentStatus: "unpaid",
    subtotal: 0, discount: 0, total: 0, dueDate: "2026-06-11T10:00:00.000Z", createdAt: "2026-06-01T00:00:00.000Z",
    notes: "", inventoryDeducted: false, foodColoring: null, ...partial,
  };
}

describe("packMultiplierFor", () => {
  it("returns 1 when the product has no pack sizes", () => {
    expect(packMultiplierFor({ price: 2 }, conchas)).toBe(1);
  });

  it("matches a pack by price", () => {
    expect(packMultiplierFor({ price: 15 }, cupcake)).toBe(6);
    expect(packMultiplierFor({ price: 28 }, cupcake)).toBe(12);
  });

  it("falls back to 1 when no pack price matches", () => {
    expect(packMultiplierFor({ price: 3 }, cupcake)).toBe(1);
  });
});

describe("computePrepList", () => {
  const window = ["2026-06-11", "2026-06-12"] as const;

  it("aggregates needs across orders and products", () => {
    const orders = [
      mkOrder({ id: "1", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-conchas", name: "Conchas", emoji: "🍞", qty: 12, price: 2 }] }),
      mkOrder({ id: "2", dueDate: "2026-06-12T10:00:00.000Z", items: [{ productId: "prod-cup", name: "Cupcakes", emoji: "🧁", qty: 1, price: 15 }] }),
    ];
    const r = computePrepList(orders, [conchas, cupcake], [flour, eggs], window[0], window[1]);
    const flourNeed = r.needs.find((n) => n.inventoryItemId === "inv-flour")!;
    expect(flourNeed.need).toBeCloseTo(12 * 1.5 + 6 * 0.5); // 21
    expect(flourNeed.have).toBe(6);
    expect(flourNeed.short).toBeCloseTo(15);
    expect(flourNeed.ok).toBe(false);
    const eggsNeed = r.needs.find((n) => n.inventoryItemId === "inv-eggs")!;
    expect(eggsNeed.need).toBe(12);
    expect(eggsNeed.ok).toBe(true);
  });

  it("excludes cancelled orders and orders outside the window", () => {
    const orders = [
      mkOrder({ id: "cancelled", status: "cancelled", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-conchas", name: "Conchas", emoji: "🍞", qty: 100, price: 2 }] }),
      mkOrder({ id: "outside", dueDate: "2026-06-20T10:00:00.000Z", items: [{ productId: "prod-conchas", name: "Conchas", emoji: "🍞", qty: 100, price: 2 }] }),
    ];
    const r = computePrepList(orders, [conchas], [flour], window[0], window[1]);
    expect(r.needs).toHaveLength(0);
    expect(r.ordersCovered).toHaveLength(0);
  });

  it("collects items whose product has no recipe into withoutRecipe", () => {
    const orders = [
      mkOrder({ id: "1", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-norecipe", name: "Custom Cake", emoji: "🎂", qty: 1, price: 50 }] }),
      mkOrder({ id: "2", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-other", name: "Other", emoji: "🍞", qty: 3, price: 2 }] }),
    ];
    const r = computePrepList(orders, [noRecipe, noProduct], [flour], window[0], window[1]);
    expect(r.withoutRecipe).toHaveLength(2);
    expect(r.withoutRecipe[0].productId).toBe("prod-norecipe");
    expect(r.needs).toHaveLength(0);
  });

  it("flags inactive inventory items", () => {
    const orders = [
      mkOrder({ id: "1", dueDate: "2026-06-11T10:00:00.000Z", items: [{ productId: "prod-conchas", name: "Conchas", emoji: "🍞", qty: 1, price: 2 }] }),
    ];
    const r = computePrepList(orders, [conchas], [retired, flour, eggs], window[0], window[1]);
    const ret = r.needs.find((n) => n.inventoryItemId === "inv-ret")!;
    expect(ret.inactive).toBe(true);
  });

  it("returns empty result for empty orders", () => {
    const r = computePrepList([], [conchas], [flour], window[0], window[1]);
    expect(r.needs).toEqual([]);
    expect(r.withoutRecipe).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/utils/prepList.test.ts`
Expected: FAIL — `Cannot find module './prepList'`.

- [ ] **Step 3: Write minimal implementation `src/utils/prepList.ts`**

```ts
import type { InventoryItem, Order, Product } from "../types";

export interface PrepNeed {
  inventoryItemId: string;
  name: string;
  unit: string;
  need: number;
  have: number;
  short: number;
  ok: boolean;
  inactive: boolean;
  orderIds: string[];
}

export interface PrepLineWithoutRecipe {
  productId: string;
  productName: string;
  qty: number;
}

export interface PrepListResult {
  windowStart: string;
  windowEnd: string;
  needs: PrepNeed[];
  withoutRecipe: PrepLineWithoutRecipe[];
  ordersCovered: Order[];
}

export function packMultiplierFor(orderItem: { price: number }, product: Product): number {
  if (!product.pack_sizes || product.pack_sizes.length === 0) return 1;
  const match = product.pack_sizes.find((p) => Number(p.price) === orderItem.price);
  return match ? match.qty : 1;
}

export function computePrepList(
  orders: Order[],
  products: Product[],
  inventory: InventoryItem[],
  windowStart: string,
  windowEnd: string,
): PrepListResult {
  const invById = new Map(inventory.map((i) => [i.id, i]));
  const needMap = new Map<string, PrepNeed>();
  const withoutRecipe: PrepLineWithoutRecipe[] = [];
  const ordersCovered: Order[] = [];

  const activeOrders = orders.filter((o) => {
    if (o.status === "completed" || o.status === "cancelled") return false;
    const d = o.dueDate.slice(0, 10);
    return d >= windowStart && d <= windowEnd;
  });

  for (const o of activeOrders) {
    let contributes = false;
    for (const item of o.items) {
      const product = products.find((p) => p.id === item.productId);
      if (!product || !product.recipe || product.recipe.length === 0) {
        withoutRecipe.push({ productId: item.productId, productName: item.name, qty: item.qty });
        contributes = true;
        continue;
      }
      const multiplier = packMultiplierFor(item, product);
      const unitQty = item.qty * multiplier;
      for (const line of product.recipe) {
        const entry = needMap.get(line.inventoryItemId);
        const inv = invById.get(line.inventoryItemId);
        const amount = unitQty * line.qtyPerUnit;
        if (entry) {
          entry.need += amount;
          if (!entry.orderIds.includes(o.id)) entry.orderIds.push(o.id);
        } else {
          needMap.set(line.inventoryItemId, {
            inventoryItemId: line.inventoryItemId,
            name: inv?.name ?? line.inventoryItemId,
            unit: inv?.unit ?? "",
            need: amount,
            have: inv?.quantity ?? 0,
            short: 0,
            ok: false,
            inactive: inv ? inv.active === false : false,
            orderIds: [o.id],
          });
        }
        contributes = true;
      }
    }
    if (contributes) ordersCovered.push(o);
  }

  const needs = [...needMap.values()].map((n) => ({
    ...n,
    short: Math.max(0, n.need - n.have),
    ok: n.need <= n.have,
  }));

  needs.sort((a, b) => b.short - a.short || a.name.localeCompare(b.name));

  return { windowStart, windowEnd, needs, withoutRecipe, ordersCovered };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/utils/prepList.test.ts`
Expected: all PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/prepList.ts src/utils/prepList.test.ts
git commit -m "feat(calendar): computePrepList ingredient aggregation util"
```

---

### Task 4: `calendarGrid` helper + unit tests

Pure month-grid builder used by the Month view.

**Files:**
- Create: `src/utils/calendarGrid.ts`
- Create: `src/utils/calendarGrid.test.ts`

**Interfaces:**
- Produces:
  - `interface CalendarCell { date: Date; iso: string; inMonth: boolean; isToday: boolean }`
  - `function calendarGrid(year: number, monthIndex: number, todayIso?: string): CalendarCell[]` — always 42 cells, weeks starting Sunday, `inMonth` false for leading/trailing blanks.

- [ ] **Step 1: Write the failing test `src/utils/calendarGrid.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { calendarGrid } from "./calendarGrid";

describe("calendarGrid", () => {
  it("always returns 42 cells (6 weeks)", () => {
    expect(calendarGrid(2026, 5)).toHaveLength(42);
  });

  it("June 2026 starts on a Monday (index 1) with one leading blank", () => {
    const cells = calendarGrid(2026, 5);
    expect(cells[0].inMonth).toBe(false);
    expect(cells[0].iso).toBe("2026-05-31");
    expect(cells[1].iso).toBe("2026-06-01");
    expect(cells[1].inMonth).toBe(true);
  });

  it("labels the first day of June as in-month", () => {
    const cells = calendarGrid(2026, 5);
    expect(cells[1].iso).toBe("2026-06-01");
  });

  it("marks today via todayIso", () => {
    const cells = calendarGrid(2026, 5, "2026-06-11");
    const today = cells.find((c) => c.isToday);
    expect(today?.iso).toBe("2026-06-11");
  });

  it("marks the last in-month cell as June 30", () => {
    const cells = calendarGrid(2026, 5);
    const lastInMonth = cells.filter((c) => c.inMonth).at(-1);
    expect(lastInMonth?.iso).toBe("2026-06-30");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/utils/calendarGrid.test.ts`
Expected: FAIL — `Cannot find module './calendarGrid'`.

- [ ] **Step 3: Write minimal implementation `src/utils/calendarGrid.ts`**

```ts
export interface CalendarCell {
  date: Date;
  iso: string;
  inMonth: boolean;
  isToday: boolean;
}

export function calendarGrid(year: number, monthIndex: number, todayIso?: string): CalendarCell[] {
  const first = new Date(year, monthIndex, 1);
  const offset = first.getDay();
  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(year, monthIndex, 1 - offset + i);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    cells.push({
      date,
      iso,
      inMonth: date.getMonth() === monthIndex,
      isToday: iso === todayIso,
    });
  }
  return cells;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/utils/calendarGrid.test.ts`
Expected: all PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/calendarGrid.ts src/utils/calendarGrid.test.ts
git commit -m "feat(calendar): calendarGrid month helper"
```

---

### Task 5: `useReminders` hook + smoke test

The hook that powers the bell, the dashboard widget, and the Calendar side panel.

**Files:**
- Create: `src/hooks/useReminders.ts`
- Create: `src/hooks/useReminders.test.tsx`

**Interfaces:**
- Consumes: `useStore` from `../context/StoreContext`; `computeReminders`, `loadDismissMap`, `saveDismissMap`, `isSnoozed`, `isDismissedToday`, `loadReminderConfig` from `../utils/reminders`; `Reminder` type.
- Produces:
  - `function useReminders(): { reminders: Reminder[]; unreadCount: number; snooze: (orderId: string, hours: number) => void; dismiss: (orderId: string) => void; markAllRead: () => void }`

- [ ] **Step 1: Write the failing test `src/hooks/useReminders.test.tsx`**

```tsx
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useReminders } from "./useReminders";

vi.mock("../context/StoreContext", () => ({
  useStore: vi.fn(),
}));

import { useStore } from "../context/StoreContext";
import type { Order } from "../types";
import { DEFAULT_REMINDER_CONFIG } from "../types";

const mkOrder = (partial: Partial<Order>): Order => ({
  id: "1", orderNumber: "MR-1", customerId: null, customerName: "Test", phone: "", items: [],
  source: "website", status: "pending", paymentMethod: null, paymentSubMethod: null, paymentStatus: "unpaid",
  subtotal: 0, discount: 0, total: 0, dueDate: "2026-06-11T10:00:00.000Z", createdAt: "2026-06-01T00:00:00.000Z",
  notes: "", inventoryDeducted: false, foodColoring: null, ...partial,
});

const mockedUseStore = useStore as unknown as ReturnType<typeof vi.fn>;

function iso(daysFromNow: number): string {
  const d = new Date("2026-06-11T00:00:00.000Z");
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString();
}

describe("useReminders", () => {
  let container: HTMLElement;
  let root: Root;
  let result: ReturnType<typeof useReminders>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T08:00:00Z"));
    mockedUseStore.mockReturnValue({
      orders: [mkOrder({ id: "od", dueDate: iso(-1) }), mkOrder({ id: "tod", dueDate: iso(0) })],
      profile: { reminders: DEFAULT_REMINDER_CONFIG },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function Harness() {
    result = useReminders();
    return null;
  }

  it("returns reminders + unreadCount from orders", () => {
    act(() => root.render(<Harness />));
    expect(result!.reminders.map((r) => r.order.id)).toEqual(["od", "tod"]);
    expect(result!.unreadCount).toBe(2);
  });

  it("dismiss hides an order from unreadCount until tomorrow", () => {
    act(() => root.render(<Harness />));
    act(() => result!.dismiss("tod"));
    expect(result!.unreadCount).toBe(1);
  });

  it("markAllRead hides all for today", () => {
    act(() => root.render(<Harness />));
    act(() => result!.markAllRead());
    expect(result!.unreadCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/hooks/useReminders.test.tsx`
Expected: FAIL — `Cannot find module './useReminders'`.

- [ ] **Step 3: Write minimal implementation `src/hooks/useReminders.ts`**

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../context/StoreContext";
import {
  computeReminders,
  isSnoozed,
  isDismissedToday,
  loadDismissMap,
  saveDismissMap,
  loadReminderConfig,
  type Reminder,
} from "../utils/reminders";

const TICK_MS = 60_000;

export function useReminders() {
  const { orders, profile } = useStore();
  const config = useMemo(() => loadReminderConfig(profile?.reminders), [profile?.reminders]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let hidden = document.hidden;
    const onVisibility = () => {
      hidden = document.hidden;
      if (!hidden) setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVisibility);
    const id = setInterval(() => {
      if (!hidden) setNow(new Date());
    }, TICK_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(id);
    };
  }, []);

  const computed = useMemo(() => computeReminders(orders, config, now), [orders, config, now]);

  const visible = useMemo(() => {
    const map = loadDismissMap();
    return computed.filter((r) => {
      const d = map[r.order.id];
      if (!d) return true;
      if (isSnoozed(d, now)) return false;
      return !isDismissedToday(d, now);
    });
  }, [computed, now]);

  const snooze = useCallback((orderId: string, hours: number) => {
    const map = loadDismissMap();
    map[orderId] = { dismissedAt: new Date().toISOString(), snoozedUntil: new Date(Date.now() + hours * 3_600_000).toISOString() };
    saveDismissMap(map);
    setNow(new Date());
  }, []);

  const dismiss = useCallback((orderId: string) => {
    const map = loadDismissMap();
    map[orderId] = { dismissedAt: new Date().toISOString(), snoozedUntil: null };
    saveDismissMap(map);
    setNow(new Date());
  }, []);

  const markAllRead = useCallback(() => {
    const map = loadDismissMap();
    const stamped = new Date().toISOString();
    computed.forEach((r) => {
      map[r.order.id] = { dismissedAt: stamped, snoozedUntil: null };
    });
    saveDismissMap(map);
    setNow(new Date());
  }, [computed]);

  return {
    reminders: visible,
    unreadCount: visible.length,
    snooze,
    dismiss,
    markAllRead,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/hooks/useReminders.test.tsx`
Expected: all PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useReminders.ts src/hooks/useReminders.test.tsx
git commit -m "feat(calendar): useReminders hook with dismiss + snooze"
```

---

### Task 6: `ReminderBell` component + Topbar integration

**Files:**
- Create: `src/components/ReminderBell.tsx`
- Modify: `src/components/Topbar.tsx`

**Interfaces:**
- Consumes: `useReminders` from `../hooks/useReminders`; `dueTier`, `DUE_TIER_LABELS` from `../utils/format`; `formatCurrency`, `formatDate` from `../utils/format`; `cn` from `../utils/cn`; lucide `Bell`, `CheckCheck`, `Clock`, `CalendarDays` icons.
- Produces: `ReminderBell({ onOpenCalendar, onOpenDate }: { onOpenCalendar: () => void; onOpenDate: (isoDate: string) => void })`
- Topbar produces: `onOpenCalendar: () => void` and `onOpenDate: (isoDate: string) => void` props.

- [ ] **Step 1: Create `src/components/ReminderBell.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { Bell, CalendarDays, CheckCheck, Clock } from "lucide-react";
import { useReminders } from "../hooks/useReminders";
import { dueTier, DUE_TIER_LABELS, formatCurrency, formatDate } from "../utils/format";
import { cn } from "../utils/cn";

export default function ReminderBell({
  onOpenCalendar,
  onOpenDate,
}: {
  onOpenCalendar: () => void;
  onOpenDate: (isoDate: string) => void;
}) {
  const { reminders, unreadCount, snooze, dismiss, markAllRead } = useReminders();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const tierLabel = (o: (typeof reminders)[number]) =>
    o.tier === "leadDays" ? `Due ${formatDate(o.dueDate)}` : DUE_TIER_LABELS[dueTier(o.order.dueDate, o.order.status)];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-xl border border-sand-200 bg-white p-2.5 text-cocoa-muted transition hover:bg-sand-100 hover:text-cocoa"
        aria-label="Reminders"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-coral px-1 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-sand-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-sand-100 px-4 py-3">
            <p className="text-sm font-semibold text-cocoa">Reminders</p>
            {reminders.length > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-xs font-medium text-coral hover:underline">
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>

          {reminders.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-cocoa-muted">
              All caught up — no upcoming order reminders.
            </div>
          ) : (
            <div className="max-h-80 divide-y divide-sand-100 overflow-y-auto">
              {reminders.map((r) => (
                <div key={r.order.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-[10px] font-bold uppercase tracking-wide",
                      r.tier === "overdue" ? "text-hibiscus" : r.tier === "today" ? "text-coral" : r.tier === "tomorrow" ? "text-amber-600" : "text-cocoa-muted")}>
                      {r.tier}
                    </span>
                    <span className="text-xs font-semibold text-cocoa">{formatCurrency(r.order.total)}</span>
                  </div>
                  <p className="mt-0.5 text-sm font-medium text-cocoa">
                    {r.order.orderNumber} · {r.order.customerName}
                  </p>
                  <p className="text-xs text-cocoa-muted">{tierLabel(r)} · {r.order.items.length} item(s)</p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => { onOpenDate(r.order.dueDate.slice(0, 10)); setOpen(false); }}
                      className="flex items-center gap-1 rounded-lg border border-sand-200 px-2 py-1 text-xs font-medium text-palm hover:bg-sand-50"
                    >
                      <CalendarDays size={12} /> View
                    </button>
                    <button
                      onClick={() => snooze(r.order.id, 24)}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-cocoa-muted hover:bg-sand-100"
                    >
                      <Clock size={12} /> Snooze 24h
                    </button>
                    <button
                      onClick={() => dismiss(r.order.id)}
                      className="ml-auto text-xs font-medium text-cocoa-muted hover:text-hibiscus"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => { onOpenCalendar(); setOpen(false); }}
            className="w-full border-t border-sand-100 bg-sand-50 px-4 py-2.5 text-center text-xs font-semibold text-palm hover:bg-sand-100"
          >
            Open Calendar →
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `src/components/Topbar.tsx`**

Add `ReminderBell` between the search box and the **+ New Order** button, and add the two new props:

```tsx
import { Menu, Plus, Search } from "lucide-react";
import type { Page } from "../App";
import ReminderBell from "./ReminderBell";

const TITLES: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Your bakery at a glance" },
  orders: { title: "Orders", subtitle: "Track website & in-person orders" },
  calendar: { title: "Calendar", subtitle: "Upcoming orders, reminders & prep" },
  quotes: { title: "Cake Quotes", subtitle: "Custom cake quote requests" },
  // ...rest unchanged
};

export default function Topbar({
  page,
  onMenuClick,
  onNewOrder,
  onOpenCalendar,
  onOpenDate,
  search,
  setSearch,
}: {
  page: Page;
  onMenuClick: () => void;
  onNewOrder: () => void;
  onOpenCalendar: () => void;
  onOpenDate: (isoDate: string) => void;
  search?: string;
  setSearch?: (v: string) => void;
}) {
  // ...TITLES unchanged...

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-sand-200 bg-sand-50/90 px-4 py-4 backdrop-blur-sm sm:px-6">
      {/* left side unchanged */}
      <div className="flex items-center gap-2">
        {setSearch && (
          <div className="hidden items-center gap-2 rounded-xl border border-sand-200 bg-white px-3 py-2 sm:flex">
            <Search size={16} className="text-cocoa-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-40 bg-transparent text-sm text-cocoa outline-none placeholder:text-cocoa-muted"
            />
          </div>
        )}
        <ReminderBell onOpenCalendar={onOpenCalendar} onOpenDate={onOpenDate} />
        <button onClick={onNewOrder} className="btn-primary px-3.5 py-2.5 sm:px-4">
          <Plus size={16} />
          <span className="hidden sm:inline">New Order</span>
        </button>
      </div>
    </div>
  );
}
```

**Note:** `App.tsx` does not yet pass the new props — that lands in Task 7. Running the dev server after this task will show a TS error in the console until Task 7 completes. That's expected within this task's boundary; do not "fix" it by editing App.tsx here.

- [ ] **Step 3: Verify the build still passes (App.tsx types will surface as esbuild warnings only)**

Run: `npm run build`
Expected: build completes (esbuild ignores the missing props; vite type-checking is off). Do not gate on `tsc`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ReminderBell.tsx src/components/Topbar.tsx
git commit -m "feat(calendar): reminder bell dropdown in topbar"
```

---

### Task 7: Calendar page shell — routing, nav, Month / Week / List views

**Files:**
- Create: `src/pages/CalendarView.tsx` (shell + Month/Week/List; Day view + side panel land in Tasks 8–9)
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: `useStore`, `calendarGrid`, `useReminders`, `dueTier`, `urgencyRank`, `formatCurrency`, `formatDate`, `ProductIcon`, `Badge`, `cn`.
- Produces:
  - `function CalendarView({ setPage, onOpenInventory }: { setPage: (p: Page) => void; onOpenInventory: (highlightId: string) => void }): JSX.Element`
  - `"calendar"` added to `Page` union in `src/App.tsx`.
  - Helper exports from CalendarView for later tasks: `type CalendarViewMode = "month" | "week" | "day" | "list"`, `function ordersByIso(orders: Order[]): Map<string, Order[]>`.

- [ ] **Step 1: Modify `src/App.tsx` — add the page + wire Topbar + render CalendarView**

Changes:
1. `Page` union: add `| "calendar"` after `"orders"`.
2. Import `CalendarView`.
3. Add state `const [inventoryHighlightId, setInventoryHighlightId] = useState<string | null>(null);`
4. Topbar: add `onOpenCalendar={() => setPage("calendar")}` and `onOpenDate={(isoDate) => { setPage("calendar"); /* hash drives the day view */ window.location.hash = `calendar/${isoDate}`; }}`
5. Add a hash-reading effect so deep links like `#calendar/2026-06-11` land on that date's Day view (this is what Task 13 checklist item 10 verifies). Insert after the `page` state declarations:

```tsx
useEffect(() => {
  const m = window.location.hash.match(/^#calendar\/(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    setPage("calendar");
    window.location.hash = "";
  }
}, []);
```

The `setPage("calendar")` here is a no-op if already on the page; the hash hand-off to `CalendarView` happens in Task 7 Step 4 via its own mount effect (below).

6. Render: `{page === "calendar" && <CalendarView setPage={setPage} onOpenInventory={(id) => { setInventoryHighlightId(id); setPage("inventory"); }} />}`
6. Inventory render: `{page === "inventory" && <Inventory search={search} highlightId={inventoryHighlightId} onGoToCalendar={() => setPage("calendar")} />}` (new props implemented in Task 11 — TS/esbuild tolerant; if esbuild complains, cast `Inventory` call-site props with `as any` temporarily? NO — instead, implement the props in Task 11. Until then the dev build will error. To keep every task green, use a local stub: see Step 4 note.) — see Step 4 for the ordering fix.

- [ ] **Step 2: Modify `src/components/Sidebar.tsx` — nav item + badge**

Add `CalendarDays` to lucide imports; insert into `NAV` after `orders`:

```tsx
import { LayoutDashboard, ClipboardList, CalendarDays, Cookie, Images, Home, Package, Users, Wallet, Mail, Tag, Settings, MessageSquareQuote } from "lucide-react";
import { useReminders } from "../hooks/useReminders";

const NAV: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "quotes", label: "Cake Quotes", icon: MessageSquareQuote },
  // ...rest unchanged
];
```

In the component, replace the `const { quotes } = useStore();` line with:

```tsx
const { quotes } = useStore();
const { unreadCount } = useReminders();
const pendingCount = quotes.filter((q) => q.status === "new").length;
```

And change the badge logic from:
```tsx
const badge = item.id === "quotes" && pendingCount > 0 ? pendingCount : 0;
```
to:
```tsx
const badge =
  item.id === "quotes" && pendingCount > 0 ? pendingCount :
  item.id === "calendar" && unreadCount > 0 ? unreadCount : 0;
```

- [ ] **Step 3: Create `src/pages/CalendarView.tsx` — shell, Month, Week, List**

```tsx
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, List, CalendarDays, CalendarRange, CalendarClock } from "lucide-react";
import { useStore } from "../context/StoreContext";
import { useReminders } from "../hooks/useReminders";
import { calendarGrid, type CalendarCell } from "../utils/calendarGrid";
import { dueTier, DUE_TIER_LABELS, formatCurrency, formatDate, urgencyRank } from "../utils/format";
import { cn } from "../utils/cn";
import Badge from "../components/ui/Badge";
import ProductIcon from "../components/ProductIcon";
import type { Order } from "../types";
import type { Page } from "../App";

export type CalendarViewMode = "month" | "week" | "day" | "list";

export function ordersByIso(orders: Order[]): Map<string, Order[]> {
  const map = new Map<string, Order[]>();
  for (const o of orders) {
    if (o.status === "completed" || o.status === "cancelled") continue;
    const iso = o.dueDate.slice(0, 10);
    const arr = map.get(iso) ?? [];
    arr.push(o);
    map.set(iso, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => urgencyRank(a) - urgencyRank(b));
  return map;
}

export default function CalendarView({
  setPage,
  onOpenInventory,
}: {
  setPage: (p: Page) => void;
  onOpenInventory: (highlightId: string) => void;
}) {
  const { orders } = useStore();
  const { unreadCount } = useReminders();
  const [mode, setMode] = useState<CalendarViewMode>("month");
  const [cursor, setCursor] = useState(() => new Date());

  const byIso = useMemo(() => ordersByIso(orders), [orders]);

  // Deep links: #calendar/2026-06-11 → that date's Day view
  useEffect(() => {
    const m = window.location.hash.match(/^#calendar\/(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      setMode("day");
      setCursor(new Date(m[1] + "T12:00:00"));
    }
  }, []);

  const todayIso = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c);
      if (mode === "month") d.setMonth(d.getMonth() + delta);
      else if (mode === "week") d.setDate(d.getDate() + delta * 7);
      else d.setDate(d.getDate() + delta);
      return d;
    });
  }

  function tierFor(o: Order) {
    return dueTier(o.dueDate, o.status);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-sand-200 bg-white p-1 shadow-sm">
          {(["month", "week", "day", "list"] as CalendarViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition",
                mode === m ? "bg-palm text-white" : "text-cocoa-muted hover:bg-sand-100",
              )}
            >
              {m === "month" ? <CalendarDays size={14} /> : m === "week" ? <CalendarRange size={14} /> : m === "day" ? <CalendarClock size={14} /> : <List size={14} />}
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-sand-200 bg-white px-2 py-1 shadow-sm">
            <button onClick={() => shift(-1)} className="rounded-lg p-1.5 text-cocoa-muted hover:bg-sand-100" aria-label="Previous">
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-32 text-center text-sm font-semibold text-cocoa">{monthLabel}</span>
            <button onClick={() => shift(1)} className="rounded-lg p-1.5 text-cocoa-muted hover:bg-sand-100" aria-label="Next">
              <ChevronRight size={16} />
            </button>
          </div>
          {unreadCount > 0 && (
            <Badge tone="today">{unreadCount} reminder{unreadCount === 1 ? "" : "s"}</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          {mode === "month" && <MonthGrid byIso={byIso} cursor={cursor} todayIso={todayIso} onSelect={(iso) => setCursor(new Date(iso + "T12:00:00")); setMode("day")} />}
          {mode === "week" && <WeekGrid byIso={byIso} cursor={cursor} todayIso={todayIso} onSelect={(iso) => { setCursor(new Date(iso + "T12:00:00")); setMode("day"); }} />}
          {mode === "list" && <ListView byIso={byIso} />}
          {mode === "day" && (
            <div className="rounded-xl border border-sand-200 bg-white p-6 text-center text-sm text-cocoa-muted">
              Day view ships in the next task.
            </div>
          )}
        </div>

        <div className="w-full lg:w-80">
          <div className="rounded-xl border border-sand-200 bg-white p-4 text-center text-sm text-cocoa-muted">
            Side panel (reminders + prep list) ships in Task 9.
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ byIso, cursor, todayIso, onSelect }: {
  byIso: Map<string, Order[]>;
  cursor: Date;
  todayIso: string;
  onSelect: (iso: string) => void;
}) {
  const cells = calendarGrid(cursor.getFullYear(), cursor.getMonth(), todayIso);
  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 border-b border-sand-100 bg-sand-50 text-center text-[11px] font-semibold uppercase tracking-wide text-cocoa-muted">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell) => (
          <MonthCell key={cell.iso} cell={cell} orders={byIso.get(cell.iso) ?? []} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function MonthCell({ cell, orders, onSelect }: { cell: CalendarCell; orders: Order[]; onSelect: (iso: string) => void }) {
  const maxTier = orders.reduce<ReturnType<typeof dueTier> | null>((acc, o) => {
    const t = dueTier(o.dueDate, o.status);
    if (t === "overdue") return "overdue";
    if (t === "today" && acc !== "overdue") return "today";
    if (t === "tomorrow" && acc !== "overdue" && acc !== "today") return "tomorrow";
    return acc;
  }, null);
  return (
    <button
      onClick={() => onSelect(cell.iso)}
      className={cn(
        "flex min-h-16 flex-col gap-1 border-r border-b border-sand-100 p-1.5 text-left transition hover:bg-sand-50",
        !cell.inMonth && "bg-sand-50/60 opacity-50",
      )}
    >
      <span className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full text-xs",
        cell.isToday ? "bg-coral font-bold text-white" : "text-cocoa",
      )}>
        {cell.date.getDate()}
      </span>
      <div className="space-y-0.5">
        {orders.slice(0, 3).map((o) => (
          <div key={o.id} className="flex items-center gap-1 text-[10px] text-cocoa-muted">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
              dueTier(o.dueDate, o.status) === "overdue" ? "bg-hibiscus" :
              dueTier(o.dueDate, o.status) === "today" ? "bg-coral" :
              dueTier(o.dueDate, o.status) === "tomorrow" ? "bg-amber-500" : "bg-mid-green")} />
            <span className="truncate">{o.orderNumber}</span>
          </div>
        ))}
        {orders.length > 3 && <p className="text-[10px] font-medium text-coral">+{orders.length - 3} more</p>}
      </div>
    </button>
  );
}

function WeekGrid({ byIso, cursor, todayIso, onSelect }: {
  byIso: Map<string, Order[]>;
  cursor: Date;
  todayIso: string;
  onSelect: (iso: string) => void;
}) {
  const start = new Date(cursor);
  start.setDate(start.getDate() - start.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="grid grid-cols-7 gap-px bg-sand-100">
        {days.map((d) => {
          const dIso = iso(d);
          const orders = byIso.get(dIso) ?? [];
          const isToday = dIso === todayIso;
          return (
            <button key={dIso} onClick={() => onSelect(dIso)} className="flex min-h-40 flex-col gap-1 bg-white p-2 text-left transition hover:bg-sand-50">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase text-cocoa-muted">{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold", isToday ? "bg-coral text-white" : "text-cocoa")}>
                  {d.getDate()}
                </span>
              </div>
              <div className="mt-1 space-y-1">
                {orders.slice(0, 3).map((o) => (
                  <div key={o.id} className="rounded-md bg-sand-50 px-1.5 py-1 text-[10px] font-medium text-cocoa ring-1 ring-inset ring-sand-200">
                    {o.orderNumber} · {formatCurrency(o.total)}
                  </div>
                ))}
                {orders.length > 3 && <p className="text-[10px] font-medium text-coral">+{orders.length - 3} more</p>}
                {orders.length === 0 && <p className="text-[10px] text-cocoa-muted">—</p>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ListView({ byIso }: { byIso: Map<string, Order[]> }) {
  const all = [...byIso.entries()]
    .filter(([iso]) => iso >= new Date().toISOString().slice(0, 10))
    .flatMap(([, orders]) => orders)
    .sort((a, b) => urgencyRank(a) - urgencyRank(b));
  if (all.length === 0) {
    return <div className="rounded-xl border border-sand-200 bg-white p-10 text-center text-sm text-cocoa-muted">No upcoming orders.</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="divide-y divide-sand-100">
        {all.map((o) => {
          const tier = dueTier(o.dueDate, o.status);
          return (
            <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cocoa">{o.orderNumber} · {o.customerName}</p>
                <p className="text-xs text-cocoa-muted">{formatDate(o.dueDate)} · {o.items.length} item(s)</p>
              </div>
              <div className="flex items-center gap-2">
                {tier !== "inactive" && <Badge tone={tier}>{DUE_TIER_LABELS[tier]}</Badge>}
                <span className="text-sm font-semibold text-cocoa">{formatCurrency(o.total)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 4 ordering note:** `App.tsx` will reference `Inventory` props `highlightId`/`onGoToCalendar` that don't exist until Task 11. To keep the build green at the end of THIS task, temporarily pass only `search` (leave the Inventory call-site unchanged in this task; do NOT add the new props until Task 11). Same for the new Topbar props — add them in this task's App edit. The `CalendarView` prop `onOpenInventory` is passed but unused until Task 11 — that's fine (it's an interface contract; `noUnusedParameters` is off in build).

- [ ] **Step 5: Verify**

Run: `npm run build`
Expected: build succeeds.

Run: `npm test`
Expected: all tests pass.

Manual smoke (optional): `npm run dev`, open http://localhost:5173/, sidebar shows **Calendar**, badge appears if seed orders are due, Month/Week/List views render.

- [ ] **Step 6: Commit**

```bash
git add src/pages/CalendarView.tsx src/App.tsx src/components/Sidebar.tsx
git commit -m "feat(calendar): calendar page shell with month/week/list views"
```

---

### Task 8: Day view with pickup-time timeline

**Files:**
- Modify: `src/pages/CalendarView.tsx` (replace the Day placeholder)
- Modify: `src/components/OrderModal.tsx` (add `defaultDueDate` prop)

**Interfaces:**
- Consumes: `useStore` (`orders`, `profile`), `ordersByIso` (Task 7), `loadReminderConfig` from `../utils/reminders`, `OrderModal`, `ProductIcon`, `cn`, `Badge`, lucide `ChevronLeft/Right`, `Plus`, `Clock`.
- Produces:
  - `OrderModal` accepts `defaultDueDate?: string` — used as the initial `dueDate` value.
  - Day view renders a timeline for `dayStartTime`–`dayEndTime` from reminder config, plus an "unscheduled" bucket.
  - A `onOpenInventory` passthrough and a "Prep needs for this day" button that scrolls to the side panel section `id="prep-panel"`.

- [ ] **Step 1: Modify `src/components/OrderModal.tsx` — optional prefill**

Change line 11:

```tsx
export default function OrderModal({ open, onClose, defaultDueDate }: { open: boolean; onClose: () => void; defaultDueDate?: string }) {
```

Change line 25:

```tsx
const [dueDate, setDueDate] = useState(() => defaultDueDate ?? new Date().toISOString().slice(0, 10));
```

**Note:** this only takes effect when the modal is mounted fresh with the prop set — the caller must render `<OrderModal key={dueDate} ...>` or conditionally mount it (see Step 3).

- [ ] **Step 2: Run existing tests**

Run: `npm test`
Expected: all pass (OrderModal has no direct tests; compile via build next).

- [ ] **Step 3: Replace the Day placeholder in `src/pages/CalendarView.tsx`**

Add imports at top (merge into existing lucide import): `Plus`, `Clock`; add `useState` for `newOrderOpen` (already imported); add `Modal` to the ui imports (`import Modal from "../components/ui/Modal";`), `OrderModal` (`import OrderModal from "../components/OrderModal";`), and `loadReminderConfig` from `../utils/reminders`. Then replace:

```tsx
{mode === "day" && (
  <div className="rounded-xl border border-sand-200 bg-white p-6 text-center text-sm text-cocoa-muted">
    Day view ships in the next task.
  </div>
)}
```

with:

```tsx
{mode === "day" && (
  <DayView
    cursor={cursor}
    byIso={byIso}
    onGoMonth={() => setMode("month")}
    onNewOrder={() => setNewOrderOpen(true)}
  />
)}
```

And add to the component body (near the other state):

```tsx
const [newOrderOpen, setNewOrderOpen] = useState(false);
const selectedIso = useMemo(() => {
  const d = cursor;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}, [cursor]);
```

And append just before the closing `</div>` of the returned root:

```tsx
{newOrderOpen && (
  <OrderModal key={selectedIso} open onClose={() => setNewOrderOpen(false)} defaultDueDate={selectedIso} />
)}
```

Then append the `DayView` component at the end of the file (note: `onOpenInventory` is intentionally NOT on `DayView` — the prep/inventory bridge lives in the side panel, Task 9):

```tsx
function DayView({ cursor, byIso, onGoMonth, onNewOrder }: {
  cursor: Date;
  byIso: Map<string, Order[]>;
  onGoMonth: () => void;
  onNewOrder: () => void;
}) {
  const { profile } = useStore();
  const cfg = loadReminderConfig(profile?.reminders);
  const iso = useMemo(() => {
    const d = cursor;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [cursor]);

  const orders = byIso.get(iso) ?? [];
  const scheduled = orders.filter((o) => !Number.isNaN(new Date(o.dueDate).getHours()));
  const unscheduled = orders.filter((o) => Number.isNaN(new Date(o.dueDate).getHours()));

  const hours: number[] = [];
  for (let h = cfg.dayStartTime; h <= cfg.dayEndTime; h++) hours.push(h);

  const hourOf = (o: Order) => new Date(o.dueDate).getHours();

  return (
    <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-sand-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <button onClick={onGoMonth} className="flex h-8 w-8 items-center justify-center rounded-lg border border-sand-200 text-cocoa-muted hover:bg-sand-100" aria-label="Back to month">
            <CalendarDays size={14} />
          </button>
          <div>
            <p className="font-serif text-lg font-semibold text-cocoa">
              {cursor.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
            <p className="text-xs text-cocoa-muted">{orders.length} order{orders.length === 1 ? "" : "s"} · pickup times {cfg.dayStartTime}:00–{cfg.dayEndTime}:00</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => document.getElementById("prep-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="rounded-xl border border-palm/30 bg-white px-3 py-2 text-xs font-medium text-palm hover:bg-palm/5"
          >
            Prep needs for this day →
          </button>
          <button
            onClick={onNewOrder}
            className="rounded-xl bg-palm px-3 py-2 text-xs font-semibold text-white hover:shadow-md"
          >
            + New order for this day
          </button>
        </div>
      </div>

      <div className="relative">
        {hours.map((h) => {
          const cellOrders = scheduled.filter((o) => hourOf(o) === h);
          return (
            <div key={h} className="flex border-b border-sand-100 last:border-b-0">
              <div className="w-16 shrink-0 border-r border-sand-100 px-3 py-3 text-right font-mono text-xs text-cocoa-muted">
                {h > 12 ? h - 12 : h}:00{h >= 12 ? "pm" : "am"}
              </div>
              <div className="min-h-16 flex-1 space-y-1.5 px-3 py-2">
                {cellOrders.map((o) => <OrderTimelineCard key={o.id} order={o} />)}
                {cellOrders.length === 0 && <p className="px-2 py-1 text-xs italic text-cocoa-muted/60">open</p>}
              </div>
            </div>
          );
        })}

        {unscheduled.length > 0 && (
          <div className="border-t-2 border-dashed border-sand-200 bg-sand-50/50 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-cocoa-muted">Unscheduled (no pickup time set)</p>
            <div className="space-y-1.5">
              {unscheduled.map((o) => <OrderTimelineCard key={o.id} order={o} />)}
            </div>
          </div>
        )}

        {orders.length === 0 && (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-cocoa-muted">No orders scheduled for this day.</p>
            <button onClick={onNewOrder} className="mt-3 rounded-xl bg-palm px-4 py-2 text-sm font-semibold text-white hover:shadow-md">
              + New order for this day
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

Add `OrderTimelineCard` at the end of the file:

```tsx
function OrderTimelineCard({ order }: { order: Order }) {
  const tier = dueTier(order.dueDate, order.status);
  const [detailOpen, setDetailOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setDetailOpen(true)}
        className="flex w-full flex-col gap-1 rounded-lg bg-sand-50 px-3 py-2 text-left ring-1 ring-inset ring-sand-200 transition hover:bg-sand-100"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-cocoa">{order.orderNumber} · {order.customerName}</span>
          <span className="text-sm font-semibold text-cocoa">{formatCurrency(order.total)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-cocoa-muted">
          {order.items.slice(0, 3).map((i) => (
            <span key={i.productId + i.name} className="flex items-center gap-1">
              <ProductIcon emoji={i.emoji} imageUrl={undefined} size={14} /> {i.qty}× {i.name}
            </span>
          ))}
          {order.items.length > 3 && <span>+{order.items.length - 3} more</span>}
          {tier !== "inactive" && <Badge tone={tier}>{DUE_TIER_LABELS[tier]}</Badge>}
        </div>
        {order.notes && <p className="mt-0.5 line-clamp-1 text-xs italic text-cocoa-muted">“{order.notes}”</p>}
      </button>

      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={`${order.orderNumber} · ${order.customerName}`}>
        <div className="space-y-3 text-sm">
          <p className="text-xs text-cocoa-muted">
            Pickup: {formatDate(order.dueDate)} · Payment: {order.paymentStatus}
          </p>
          <div className="divide-y divide-sand-100 rounded-xl border border-sand-100">
            {order.items.map((i) => (
              <div key={i.productId + i.name} className="flex items-center justify-between px-3 py-2">
                <span className="flex items-center gap-2 text-cocoa">
                  <ProductIcon emoji={i.emoji} imageUrl={undefined} size={16} /> {i.qty}× {i.name}
                </span>
                <span className="text-xs text-cocoa-muted">{formatCurrency(i.price)}</span>
              </div>
            ))}
          </div>
          {order.notes && <p className="rounded-lg bg-sand-50 px-3 py-2 text-xs italic text-cocoa-muted">“{order.notes}”</p>}
          <button onClick={() => setDetailOpen(false)} className="w-full rounded-xl border border-sand-200 py-2 text-sm font-medium text-cocoa hover:bg-sand-50">
            Close
          </button>
        </div>
      </Modal>
    </>
  );
}
```

**Note:** "Open in Orders" navigation is intentionally not on this card — the lightweight read-only modal (rather than duplicating Orders.tsx's 500-line inline detail modal) is a documented simplification, reviewable here. Day-view cards focus on the schedule; full order management remains on the Orders page.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds.

Run: `npm test`
Expected: all pass.

Manual: `npm run dev` → Calendar → **Day** tab → click a date with orders; unscheduled orders appear at bottom; New-order button opens OrderModal prefilled.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CalendarView.tsx src/components/OrderModal.tsx
git commit -m "feat(calendar): day view timeline + prefilled new-order modal"
```

---

### Task 9: Calendar side panel — Reminders, Day detail, Prep list

**Files:**
- Modify: `src/pages/CalendarView.tsx`

**Interfaces:**
- Consumes: `useReminders`, `computePrepList` (Task 3), `loadReminderConfig`, `useStore` (`products`, `inventory`, `apiUpdateInventoryItem`, `profile`), `onOpenInventory` prop.
- Produces: the right-side panel (id `prep-panel`) with three collapsible sections. Prep window scoping: month → whole month, week → whole week, day → that day, list → reminder window (`leadDays`).

- [ ] **Step 1: Replace the side-panel placeholder**

Replace:

```tsx
<div className="w-full lg:w-80">
  <div className="rounded-xl border border-sand-200 bg-white p-4 text-center text-sm text-cocoa-muted">
    Side panel (reminders + prep list) ships in Task 9.
  </div>
</div>
```

with:

```tsx
<div className="w-full lg:w-80">
  <SidePanel
    mode={mode}
    cursor={cursor}
    byIso={byIso}
    onOpenInventory={onOpenInventory}
  />
</div>
```

- [ ] **Step 2: Add the `SidePanel` component + helpers at the end of the file**

```tsx
function SidePanel({ mode, cursor, byIso, onOpenInventory }: {
  mode: CalendarViewMode;
  cursor: Date;
  byIso: Map<string, Order[]>;
  onOpenInventory: (highlightId: string) => void;
}) {
  const { products, inventory, apiUpdateInventoryItem, profile } = useStore();
  const { reminders, markAllRead, snooze, dismiss } = useReminders();
  const cfg = loadReminderConfig(profile?.reminders);

  const [openPrep, setOpenPrep] = useState(true);

  const windowRange = useMemo(() => {
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (mode === "month") {
      return [iso(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), iso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0))];
    }
    if (mode === "week") {
      const start = new Date(cursor); start.setDate(start.getDate() - start.getDay());
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return [iso(start), iso(end)];
    }
    if (mode === "day") {
      return [iso(cursor), iso(cursor)];
    }
    const today = iso(new Date());
    const end = new Date(); end.setDate(end.getDate() + cfg.leadDays);
    return [today, iso(end)];
  }, [mode, cursor, cfg.leadDays]);

  const prep = useMemo(
    () => computePrepList(ordersForWindow(byIso, windowRange[0], windowRange[1]), products, inventory, windowRange[0], windowRange[1]),
    [byIso, products, inventory, windowRange],
  );

  async function adjust(id: string, delta: number) {
    const current = inventory.find((i) => i.id === id)?.quantity ?? 0;
    try {
      await apiUpdateInventoryItem(id, { quantity: Math.max(0, +(current + delta).toFixed(2)) });
    } catch (err) {
      console.warn("Adjust failed:", err);
    }
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-sand-100 px-4 py-3">
          <p className="font-serif text-sm font-semibold text-cocoa">Reminders</p>
          <button onClick={markAllRead} className="text-xs font-medium text-coral hover:underline">Mark all read</button>
        </header>
        {reminders.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-cocoa-muted">No reminders in the active window.</p>
        ) : (
          <div className="divide-y divide-sand-100">
            {reminders.slice(0, 5).map((r) => (
              <div key={r.order.id} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-cocoa">{r.order.orderNumber} · {r.order.customerName}</span>
                  <Badge tone={r.tier}>{r.tier}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <button onClick={() => snooze(r.order.id, cfg.defaultSnoozeHours)} className="font-medium text-cocoa-muted hover:text-cocoa">Snooze</button>
                  <button onClick={() => dismiss(r.order.id)} className="font-medium text-cocoa-muted hover:text-hibiscus">Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
        <header className="border-b border-sand-100 px-4 py-3">
          <p className="font-serif text-sm font-semibold text-cocoa">
            {mode === "day" ? "This day" : mode === "week" ? "This week" : mode === "month" ? "This month" : "Upcoming"}
          </p>
        </header>
        {prep.ordersCovered.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-cocoa-muted">No orders in this window.</p>
        ) : (
          <div className="divide-y divide-sand-100">
            {prep.ordersCovered.map((o) => (
              <div key={o.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="truncate text-cocoa">{o.orderNumber} · {o.customerName}</span>
                <span className="text-xs text-cocoa-muted">{formatDate(o.dueDate)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="prep-panel" className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-sand-100 px-4 py-3">
          <button onClick={() => setOpenPrep((v) => !v)} className="flex flex-1 items-center justify-between">
            <span className="font-serif text-sm font-semibold text-cocoa">Prep list</span>
            <span className="text-xs text-cocoa-muted">{windowRange[0]} → {windowRange[1]}</span>
          </button>
        </header>
        {!openPrep ? null : prep.needs.length === 0 && prep.withoutRecipe.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-cocoa-muted">Nothing needed for this window.</p>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto px-4 py-3">
            {prep.needs.filter((n) => !n.ok).length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-hibiscus">Short ({prep.needs.filter((n) => !n.ok).length})</p>
                <div className="space-y-1.5">
                  {prep.needs.filter((n) => !n.ok).map((n) => (
                    <div key={n.inventoryItemId} className="rounded-lg bg-hibiscus-light/10 px-3 py-2 ring-1 ring-inset ring-hibiscus-light/30">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-cocoa">{n.name}</p>
                        <p className="text-xs text-hibiscus">✗ {n.short.toFixed(1)} {n.unit} short</p>
                      </div>
                      <p className="text-xs text-cocoa-muted">need {n.need.toFixed(1)} · have {n.have.toFixed(1)} {n.unit}</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <button onClick={() => adjust(n.inventoryItemId, n.short)} className="rounded-lg bg-palm px-2 py-1 text-[11px] font-semibold text-white hover:shadow">
                          Adjust +{n.short.toFixed(0)}
                        </button>
                        <button onClick={() => onOpenInventory(n.inventoryItemId)} className="rounded-lg border border-sand-200 px-2 py-1 text-[11px] font-medium text-cocoa-muted hover:bg-sand-100">
                          Open inventory
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {prep.needs.filter((n) => n.ok).length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-palm">OK ({prep.needs.filter((n) => n.ok).length})</p>
                <div className="space-y-1">
                  {prep.needs.filter((n) => n.ok).map((n) => (
                    <div key={n.inventoryItemId} className="flex items-center justify-between px-1 text-sm">
                      <span className="text-cocoa">{n.name}</span>
                      <span className="text-xs text-cocoa-muted">need {n.need.toFixed(1)} · have {n.have.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {prep.withoutRecipe.length > 0 && (
              <div className="rounded-lg bg-sand-50 px-3 py-2">
                <p className="text-xs font-semibold text-cocoa-muted">Needs manual entry ({prep.withoutRecipe.length})</p>
                <p className="mt-0.5 text-[11px] text-cocoa-muted">
                  {prep.withoutRecipe.map((w) => `${w.qty}× ${w.productName}`).join(", ")}
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ordersForWindow(byIso: Map<string, Order[]>, start: string, end: string): Order[] {
  const out: Order[] = [];
  for (const [iso, orders] of byIso) {
    if (iso >= start && iso <= end) out.push(...orders);
  }
  return out;
}
```

Add `ordersForWindow` import note: it is local to this file. Add missing imports at the top of CalendarView: `computePrepList` from `../utils/prepList`, `loadReminderConfig` from `../utils/reminders`, `Modal` already imported (Task 8).

- [ ] **Step 3: Verify**

Run: `npm run build` → succeeds.
Run: `npm test` → all pass.

Manual: Calendar page side panel shows Reminders, day orders, and Prep list scoped per view; "Adjust +N" updates inventory; "Open inventory" jumps to Inventory page.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CalendarView.tsx
git commit -m "feat(calendar): side panel with reminders, day detail, prep list"
```

---

### Task 10: Dashboard upcoming-reminders widget

**Files:**
- Create: `src/components/DashboardUpcomingWidget.tsx`
- Modify: `src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `useReminders`, `Badge`, `formatCurrency`, `formatDate`, lucide `Bell`.
- Produces: `DashboardUpcomingWidget({ onOpenCalendar, onOpenDate }: { onOpenCalendar: () => void; onOpenDate: (iso: string) => void })`

- [ ] **Step 1: Create `src/components/DashboardUpcomingWidget.tsx`**

```tsx
import { Bell } from "lucide-react";
import { useReminders } from "../hooks/useReminders";
import Badge from "./ui/Badge";
import { formatCurrency, formatDate } from "../utils/format";

export default function DashboardUpcomingWidget({
  onOpenCalendar,
  onOpenDate,
}: {
  onOpenCalendar: () => void;
  onOpenDate: (iso: string) => void;
}) {
  const { reminders } = useReminders();
  const top = reminders.slice(0, 3);
  return (
    <div className="rounded-xl border border-sand-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-sand-100 px-5 py-4">
        <h3 className="flex items-center gap-2 font-serif text-sm font-semibold text-cocoa">
          <Bell size={15} className="text-coral" /> Upcoming reminders
        </h3>
        <button onClick={onOpenCalendar} className="text-xs font-medium text-coral hover:underline">
          View calendar
        </button>
      </div>
      {top.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-cocoa-muted">No upcoming order reminders.</p>
          <button onClick={onOpenCalendar} className="mt-2 text-xs font-medium text-coral hover:underline">
            View calendar →
          </button>
        </div>
      ) : (
        <div className="divide-y divide-sand-100">
          {top.map((r) => (
            <button
              key={r.order.id}
              onClick={() => onOpenDate(r.order.dueDate.slice(0, 10))}
              className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition hover:bg-sand-50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cocoa">
                  {r.order.orderNumber} · {r.order.customerName}
                </p>
                <p className="text-xs text-cocoa-muted">{formatDate(r.order.dueDate)} · {r.order.items.length} item(s)</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={r.tier}>{r.tier}</Badge>
                <span className="text-sm font-semibold text-cocoa">{formatCurrency(r.order.total)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire into `src/pages/Dashboard.tsx`**

Add import: `import DashboardUpcomingWidget from "../components/DashboardUpcomingWidget";`

Insert as a new full-width card between the charts row and the "Recent orders + Best sellers" row:

```tsx
<DashboardUpcomingWidget
  onOpenCalendar={() => setPage("calendar")}
  onOpenDate={(iso) => {
    window.location.hash = `calendar/${iso}`;
    setPage("calendar");
  }}
/>
```

`setPage` already exists in Dashboard's props. No other Dashboard changes needed (the existing "Orders needing attention" list stays).

- [ ] **Step 3: Verify**

Run: `npm run build` → succeeds.
Run: `npm test` → all pass.

Manual: Dashboard shows "Upcoming reminders" card with up to 3 reminders; clicking navigates to Calendar day view.

- [ ] **Step 4: Commit**

```bash
git add src/components/DashboardUpcomingWidget.tsx src/pages/Dashboard.tsx
git commit -m "feat(calendar): dashboard upcoming reminders widget"
```

---

### Task 11: Inventory page bridge — highlight, demand column, header pill

**Files:**
- Modify: `src/pages/Inventory.tsx`
- Modify: `src/App.tsx` (pass the new props)

**Interfaces:**
- Consumes: `computePrepList`, `loadReminderConfig`, `useStore` (`orders`, `products` added to the existing destructure), existing `apiUpdateInventoryItem`.
- Produces:
  - `Inventory({ search, highlightId, onGoToCalendar }: { search: string; highlightId?: string | null; onGoToCalendar?: () => void })`
  - App passes `highlightId={inventoryHighlightId}` and `onGoToCalendar={() => setPage("calendar")}`.

- [ ] **Step 1: Update `src/App.tsx` Inventory call-site**

Replace:

```tsx
{page === "inventory" && <Inventory search={search} />}
```

with:

```tsx
{page === "inventory" && (
  <Inventory search={search} highlightId={inventoryHighlightId} onGoToCalendar={() => setPage("calendar")} />
)}
```

(`inventoryHighlightId` state was added in Task 7.)

- [ ] **Step 2: Update `src/pages/Inventory.tsx` — props + highlight**

Change the component signature:

```tsx
export default function Inventory({ search, highlightId, onGoToCalendar }: {
  search: string;
  highlightId?: string | null;
  onGoToCalendar?: () => void;
}) {
```

Add `orders` to the existing `useStore()` destructure:

```tsx
const { inventory, products, orders, apiCreateInventoryItem, apiUpdateInventoryItem, apiDeleteInventoryItem } = useStore();
```

Add a highlight effect after the `filtered` line:

```tsx
const highlightRef = useRef<HTMLTableRowElement | null>(null);
useEffect(() => {
  if (!highlightId) return;
  const el = highlightRef.current;
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("ring-2", "ring-coral", "bg-coral-light/10");
  const t = setTimeout(() => el.classList.remove("ring-2", "ring-coral", "bg-coral-light/10"), 2500);
  return () => clearTimeout(t);
}, [highlightId]);
```

(`useRef`, `useEffect` — extend the existing react import at line 1: `import { useEffect, useRef, useState, Suspense, lazy } from "react";`)

Attach the ref to the matching row (inside the `filtered.map`, on the `<tr>`):

```tsx
<tr key={i.id} ref={i.id === highlightId ? highlightRef : undefined} className="hover:bg-sand-50">
```

- [ ] **Step 3: Add the prep pill to the Inventory header**

Add `useMemo` import and compute demand inside the component (near `totalValue`):

```tsx
const { profile } = useStore();
const cfg = loadReminderConfig(profile?.reminders);
const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
const endIso = useMemo(() => {
  const d = new Date(); d.setDate(d.getDate() + cfg.leadDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}, [cfg.leadDays]);
const prep = useMemo(
  () => computePrepList(orders, products, inventory, todayIso, endIso),
  [orders, products, inventory, todayIso, endIso],
);
```

Add a pill in the header row, after the "Low stock" pill:

```tsx
{onGoToCalendar && (
  <button
    onClick={onGoToCalendar}
    className="rounded-xl border border-palm/30 bg-white px-4 py-2.5 text-sm font-medium text-palm shadow-sm transition hover:bg-palm/5"
  >
    Prep for {prep.ordersCovered.length} order{prep.ordersCovered.length === 1 ? "" : "s"} ·{" "}
    <span className="font-semibold text-hibiscus">{prep.needs.filter((n) => !n.ok).length} short</span> →
  </button>
)}
```

- [ ] **Step 4: Add the "Upcoming demand" column**

Add a toggleable column. Add state: `const [showDemand, setShowDemand] = useState(false);` Add a header-cell button in the `<thead>` after the "Reorder at" th:

```tsx
<th className="px-4 py-3">
  <button onClick={() => setShowDemand((v) => !v)} className="uppercase tracking-wide hover:text-cocoa" title="Toggle upcoming demand">
    Upcoming demand {showDemand ? "▾" : "▸"}
  </button>
</th>
```

Add a `<td>` after the "Reorder at" cell in each row:

```tsx
{showDemand && (
  <td className="px-4 py-3">
    {(() => {
      const need = prep.needs.find((n) => n.inventoryItemId === i.id);
      if (!need) return <span className="text-xs text-cocoa-muted">—</span>;
      return (
        <span className={cn("text-xs font-medium", need.ok ? "text-palm" : "text-hibiscus")}>
          {need.ok ? "" : "⚠ "}{need.need.toFixed(1)} {i.unit}
        </span>
      );
    })()}
  </td>
)}
```

Update the `<td colSpan={7}>` empty-state to `colSpan={showDemand ? 8 : 7}`.

Add `cn` import to Inventory.tsx: `import { cn } from "../utils/cn";` and `import { computePrepList } from "../utils/prepList";` and `import { loadReminderConfig } from "../utils/reminders";`.

- [ ] **Step 5: Verify**

Run: `npm run build` → succeeds.
Run: `npm test` → all pass.

Manual: Calendar prep "Open inventory" jumps to Inventory with the row highlighted; header pill shows prep counts and navigates back; demand column toggles and shows ⚠ on shortfalls.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Inventory.tsx src/App.tsx
git commit -m "feat(calendar): bridge prep list into inventory page"
```

---

### Task 12: Settings reminders card

**Files:**
- Modify: `src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `useStore` (`profile`, `handleUpdateProfile`), `saveReminderConfigToLocal`, `DEFAULT_REMINDER_CONFIG`, `ReminderConfig` type.
- Produces: a "Reminders" card in Settings editing `leadDays`, `dayOf`, `defaultSnoozeHours`, `dayStartTime`, `dayEndTime`, saved via the existing `save()` flow (which also mirrors to localStorage).

- [ ] **Step 1: Add imports to `src/pages/Settings.tsx`**

```tsx
import { saveReminderConfigToLocal } from "../utils/reminders";
import { DEFAULT_REMINDER_CONFIG, type ReminderConfig } from "../types";
```

Add `Bell` to the lucide imports.

- [ ] **Step 2: Add the Reminders card**

Insert a new card into the left column, after the "Business profile" card (after its closing `</div>` at the end of the card, before the next card). The card:

```tsx
<div className="rounded-xl border border-sand-200 bg-white p-5 shadow-sm">
  <h3 className="mb-4 flex items-center gap-2 font-serif text-sm font-semibold text-cocoa">
    <Bell size={15} className="text-coral" /> Reminders
  </h3>
  <p className="mb-4 text-xs text-cocoa-muted">
    When should the dashboard alert you before an order is due? Saved to this browser.
  </p>
  <div className="space-y-3">
    <Field label="Remind N days before due">
      <input
        type="number"
        min={1}
        max={14}
        value={draft.reminders?.leadDays ?? DEFAULT_REMINDER_CONFIG.leadDays}
        onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), leadDays: Number(e.target.value) } })}
        className="input"
      />
    </Field>
    <label className="flex items-center justify-between rounded-lg border border-sand-200 px-3 py-2.5">
      <span className="text-sm text-cocoa">Also remind on the due day</span>
      <input
        type="checkbox"
        checked={draft.reminders?.dayOf ?? DEFAULT_REMINDER_CONFIG.dayOf}
        onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), dayOf: e.target.checked } })}
        className="h-4 w-4 accent-palm"
      />
    </label>
    <Field label="Default snooze (hours)">
      <input
        type="number"
        min={1}
        value={draft.reminders?.defaultSnoozeHours ?? DEFAULT_REMINDER_CONFIG.defaultSnoozeHours}
        onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), defaultSnoozeHours: Number(e.target.value) } })}
        className="input"
      />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Day view starts at (24h)">
        <input
          type="number"
          min={0}
          max={23}
          value={draft.reminders?.dayStartTime ?? DEFAULT_REMINDER_CONFIG.dayStartTime}
          onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), dayStartTime: Number(e.target.value) } })}
          className="input"
        />
      </Field>
      <Field label="Day view ends at (24h)">
        <input
          type="number"
          min={1}
          max={24}
          value={draft.reminders?.dayEndTime ?? DEFAULT_REMINDER_CONFIG.dayEndTime}
          onChange={(e) => setDraft({ ...draft, reminders: { ...(draft.reminders ?? DEFAULT_REMINDER_CONFIG), dayEndTime: Number(e.target.value) } })}
          className="input"
        />
      </Field>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Mirror to localStorage on save**

In the existing `save()` function, add a line before `await handleUpdateProfile(draft);`:

```tsx
async function save() {
  try {
    saveReminderConfigToLocal(draft.reminders ?? DEFAULT_REMINDER_CONFIG);
    await handleUpdateProfile(draft);
  } catch (err) {
    console.error("Failed to save profile:", err);
  }
  setSaved(true);
  setTimeout(() => setSaved(false), 2000);
}
```

The server drops `reminders` from the PUT body (constraint 1) but localStorage keeps it (constraint 2), and `loadReminderConfig` (Task 2) merges localStorage over profile defaults on every read.

- [ ] **Step 4: Verify**

Run: `npm run build` → succeeds.
Run: `npm test` → all pass.

Manual: Settings → Reminders → change lead days to 5 → Save → reload page → Calendar bell still respects 5-day window; Day view hours reflect the new start/end.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(calendar): reminders settings card + localStorage mirror"
```

---

### Task 13: Final verification & cleanup

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: ALL tests pass (existing + 29 new).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds, `dist/` emits the single-file bundle.

- [ ] **Step 3: Dev-server manual checklist**

Run: `npm run dev`, open http://localhost:5173/ and verify:

1. Sidebar shows **Calendar** between Orders and Cake Quotes with badge when reminders exist.
2. Topbar bell shows badge; dropdown groups by tier; View → day view; Snooze 24h; Dismiss; Mark all read; Open Calendar.
3. Month view: dots/chips on dates with orders; click date → Day view; ‹ › shifts months.
4. Week view: 7 columns, order chips, +N more overflow.
5. Day view: timeline 9am–7pm, orders in their pickup-hour rows, unscheduled bucket, empty-state, "+ New order for this day" prefills the date.
6. Side panel: Reminders / day-orders / Prep list scoped to the active view; "Adjust +N" tops up inventory; "Open inventory" jumps to Inventory with row highlighted.
7. Dashboard: "Upcoming reminders" card links to Calendar.
8. Inventory: header pill "Prep for N orders · M short →"; "Upcoming demand" column toggles; clicking a demand cell navigates to Calendar.
9. Settings → Reminders: change lead days → Save → reload → bell respects new window; Day view hours update.
10. Deep link: open `http://localhost:5173/#calendar/2026-06-11` → lands on that date's Day view.

- [ ] **Step 4: Fix anything the checklist surfaces (iterate locally, commit as needed)**

Any deviations found → fix, re-run `npm test` + `npm run build`, commit with a clear message.

- [ ] **Step 5: Final commit (if changes were needed)**

```bash
git add -A
git commit -m "fix(calendar): polish from manual verification"
```

---

## Self-Review Notes (already applied)

- **Spec coverage:** Month/Week/Day/List views → Tasks 7–8; reminder tiers + snooze/dismiss → Tasks 2, 5, 6; prep aggregator + edge cases → Task 3; scoping + inventory bridge → Tasks 9, 11; Settings config → Task 12; dashboard widget → Task 10; config plumbing → Task 1. The spec's "unscheduled bucket", "pack-size multiplier", "withoutRecipe bucket", and "inactive inventory flag" all have dedicated tests.
- **Deviations (reviewable, user-approved direction):**
  1. Spec said config persists via profile API; reality: the worker whitelists columns, so config persists via localStorage (constraint 2). The Settings card mirrors to localStorage.
  2. Day view order-detail is a lightweight read-only modal + "Close" (no "Open in Orders" jump) instead of duplicating Orders.tsx's 500-line inline modal (Task 8 note).
  3. Pack-size multiplier resolved by price matching (constraint 5), since pack ids aren't recorded on `OrderItem`.
  4. The spec's third prep scope (custom date-range picker) is deferred — the side panel covers reminder-window (List), day (Day), week, and month scopes. The date-picker can ride on Task 13 feedback if wanted.
- **Type consistency:** `computeReminders(orders, config, now?)`, `computePrepList(orders, products, inventory, windowStart, windowEnd)`, `calendarGrid(year, monthIndex, todayIso?)`, `useReminders()` return shape, `OrderModal.defaultDueDate`, `Inventory` props, and `Topbar` props are all defined once and consumed identically across tasks.
