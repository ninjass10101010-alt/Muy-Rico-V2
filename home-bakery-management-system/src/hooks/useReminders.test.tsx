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
