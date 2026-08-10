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
