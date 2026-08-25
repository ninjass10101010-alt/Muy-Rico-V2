import type { BusinessProfile, LabelElement, LabelTemplate } from "../types";
import { disclaimerText } from "./disclaimer";

export function resolveBestBy(label: LabelTemplate, now: Date = new Date()): Date {
  if (label.bestByDate) {
    const d = new Date(label.bestByDate);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(now.getTime() + (label.bestByDays || 7) * 86400000);
}

export function formatBestBy(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function effectiveText(
  el: LabelElement,
  label: LabelTemplate,
  profile: BusinessProfile,
  bestByStr?: string
): string {
  const effName = label.businessName || profile.name || "";
  const effPhone = label.phoneNumber || profile.phone || "";
  const effReg = label.registrationNumber || profile.registrationNumber || "";
  const effAddr = label.address || profile.address || "";
  const isReg = label.businessIdMode === "registration";
  switch (el.field) {
    case "businessName": return effName;
    case "businessId":
      return isReg ? `${effPhone} · ${effReg}` : effAddr;
    case "productName": return label.productName || "";
    case "details": return label.details || "";
    case "ingredients": return label.ingredients ? `Ingredients: ${label.ingredients}` : "";
    case "allergens": return label.allergens || "";
    case "netWeight": return label.netWeightUS || label.netWeight || "";
    case "price": return label.showPrice ? label.price || "" : "";
    case "bestBy":
      return label.showBestBy ? `Best by ${bestByStr ?? formatBestBy(resolveBestBy(label))}` : "";
    case "disclaimer": return label.showDisclaimer ? disclaimerText() : "";
    default: return el.type === "text" ? el.text || "" : "";
  }
}
