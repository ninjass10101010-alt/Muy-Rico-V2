import { seedProfile } from "../data/seedData";
import type { BusinessProfile } from "../types";
import type { ApiBusinessProfile } from "./api";
import { loadReminderConfig } from "./reminders";

const KNOWN_METHODS = Object.keys(seedProfile.acceptedMethods) as (keyof BusinessProfile["acceptedMethods"])[];

export function mapProfileRow(row: ApiBusinessProfile | null): BusinessProfile {
  if (!row) return { ...seedProfile, acceptedMethods: { ...seedProfile.acceptedMethods } };

  let parsedMethods: Record<string, boolean> = {};
  try {
    if (row.acceptedMethods) {
      const p = JSON.parse(row.acceptedMethods);
      if (p && typeof p === "object") parsedMethods = p;
    }
  } catch {
    parsedMethods = {};
  }
  const acceptedMethods = Object.fromEntries(
    KNOWN_METHODS.map((k) => [k, typeof parsedMethods[k] === "boolean" ? parsedMethods[k] : seedProfile.acceptedMethods[k]])
  ) as BusinessProfile["acceptedMethods"];

  let serverReminders: BusinessProfile["reminders"] | undefined;
  try {
    if (row.reminders) {
      const raw = typeof row.reminders === "string" ? JSON.parse(row.reminders) : row.reminders;
      if (raw && typeof raw === "object") serverReminders = raw as BusinessProfile["reminders"];
    }
  } catch {
    serverReminders = undefined;
  }
  const reminders = loadReminderConfig(serverReminders);

  return {
    name: row.name || seedProfile.name,
    tagline: row.tagline || seedProfile.tagline,
    address: row.address || seedProfile.address,
    phone: row.phone || seedProfile.phone,
    email: row.email || seedProfile.email,
    website: row.website || seedProfile.website,
    registrationNumber: row.registrationNumber || seedProfile.registrationNumber,
    businessType: row.businessType === "licensed" ? "licensed" : "cottage",
    acceptedMethods,
    cashtag: row.cashtag || seedProfile.cashtag,
    venmoHandle: row.venmoHandle || seedProfile.venmoHandle,
    applePayEnabled: Boolean(row.applePayEnabled),
    stripeConnected: Boolean(row.stripeConnected),
    reminders,
  };
}
