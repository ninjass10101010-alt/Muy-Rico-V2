import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import CalendarView from "./CalendarView";
import { StoreProvider } from "../context/StoreContext";

function renderCalendarView() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <StoreProvider>
        <CalendarView onOpenInventory={() => {}} />
      </StoreProvider>,
    );
  });
  return { text: () => container.textContent ?? "", root, container };
}

describe("CalendarView deep links", () => {
  afterEach(() => {
    window.location.hash = "";
  });

  it("opens the day view for #calendar/YYYY-MM-DD on mount", () => {
    window.location.hash = "#calendar/2026-08-10";
    const { text, root, container } = renderCalendarView();
    expect(text()).toContain("Monday, August 10, 2026");
    root.unmount();
    container.remove();
  });

  it("consumes the hash so a later refresh does not force-jump to the calendar", () => {
    window.location.hash = "#calendar/2026-08-10";
    const { root, container } = renderCalendarView();
    expect(window.location.hash).toBe("");
    root.unmount();
    container.remove();
  });
});
