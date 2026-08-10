import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import DashboardUpcomingWidget from "./DashboardUpcomingWidget";
import type { Reminder } from "../utils/reminders";
import type { Order } from "../types";

vi.mock("../hooks/useReminders", () => ({
  useReminders: vi.fn(),
}));

import { useReminders } from "../hooks/useReminders";

const mockedUseReminders = useReminders as unknown as ReturnType<typeof vi.fn>;

const mkOrder = (partial: Partial<Order>): Order => ({
  id: "1", orderNumber: "MR-1", customerId: null, customerName: "Test", phone: "", items: [],
  source: "website", status: "pending", paymentMethod: null, paymentSubMethod: null, paymentStatus: "unpaid",
  subtotal: 0, discount: 0, total: 40, dueDate: "2026-06-11T10:00:00.000Z", createdAt: "2026-06-01T00:00:00.000Z",
  notes: "", inventoryDeducted: false, foodColoring: null, ...partial,
});

function renderToText(reminders: Reminder[]) {
  mockedUseReminders.mockReturnValue({ reminders });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<DashboardUpcomingWidget onOpenCalendar={() => {}} onOpenDate={() => {}} />));
  return { text: container.textContent ?? "", root, container };
}

describe("DashboardUpcomingWidget", () => {
  it("renders the heading and top 3 reminders with order info", () => {
    const { text, root, container } = renderToText([
      { order: mkOrder({ id: "a", customerName: "Alice" }), tier: "overdue", dueDate: "2026-06-10T10:00:00.000Z" },
      { order: mkOrder({ id: "b", customerName: "Bob" }), tier: "today", dueDate: "2026-06-11T10:00:00.000Z" },
      { order: mkOrder({ id: "c", customerName: "Cara" }), tier: "tomorrow", dueDate: "2026-06-12T10:00:00.000Z" },
      { order: mkOrder({ id: "d", customerName: "Dan" }), tier: "leadDays", dueDate: "2026-06-13T10:00:00.000Z" },
    ]);
    expect(text).toContain("Upcoming reminders");
    expect(text).toContain("Alice");
    expect(text).toContain("Bob");
    expect(text).toContain("Cara");
    expect(text).not.toContain("Dan");
    expect(text).toContain("$40.00");
    root.unmount();
    container.remove();
  });

  it("shows the empty state and calendar link when no reminders", () => {
    const { text, root, container } = renderToText([]);
    expect(text).toContain("No upcoming order reminders.");
    expect(text).toContain("View calendar");
    root.unmount();
    container.remove();
  });
});
