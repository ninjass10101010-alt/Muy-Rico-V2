import { DEFAULT_REMINDER_CONFIG } from "../types";
import type { Order, ReminderConfig } from "../types";

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
    const due = new Date(o.dueDate);
    if (Number.isNaN(due.getTime())) continue;
    const dueDay = new Date(due);
    dueDay.setHours(0, 0, 0, 0);
    const diffDays = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
    if (diffDays < 0) {
      res.push({ order: o, tier: "overdue", dueDate: o.dueDate });
    } else if (diffDays === 0) {
      if (config.dayOf) res.push({ order: o, tier: "today", dueDate: o.dueDate });
    } else if (diffDays === 1) {
      res.push({ order: o, tier: "tomorrow", dueDate: o.dueDate });
    } else if (diffDays >= 2 && diffDays <= config.leadDays) {
      res.push({ order: o, tier: "leadDays", dueDate: o.dueDate });
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
