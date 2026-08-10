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
  const d = new Date(2026, 5, 11 + daysFromNow, hour, 0, 0, 0);
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
