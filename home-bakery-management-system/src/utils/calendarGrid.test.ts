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
