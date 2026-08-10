import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../context/StoreContext";
import {
  computeReminders,
  isSnoozed,
  isDismissedToday,
  loadDismissMap,
  saveDismissMap,
  loadReminderConfig,
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
