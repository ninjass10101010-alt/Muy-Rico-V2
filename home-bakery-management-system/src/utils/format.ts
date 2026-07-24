import type { PaymentMethod } from "../types";

export function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function newId(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

export function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  stripe: "Card (Stripe)",
  paypal: "PayPal",
  cashapp: "Cash App",
  venmo: "Venmo",
  applepay: "Apple Pay",
  cash: "Cash",
};

export const PAYMENT_METHOD_COLORS: Record<string, string> = {
  stripe: "#635BFF",
  paypal: "#0070BA",
  cashapp: "#00D632",
  venmo: "#3D95CE",
  applepay: "#111111",
  cash: "#2E7D32",
};

export const ONLINE_ONLY: PaymentMethod[] = ["stripe", "paypal"];

export function formatPaymentSubMethod(details: string | null | undefined): string {
  if (!details) return "";
  let parsed: { type?: string; brand?: string; funding?: string; last4?: string };
  try {
    parsed = JSON.parse(details);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object") return "";
  const type = parsed.type || "";
  if (type === "paypal_wallet") return "PayPal Wallet";
  if (type === "link") return "Link";
  if (type === "card") {
    const brand = (parsed.brand || "").toLowerCase();
    const funding = (parsed.funding || "").toLowerCase();
    const brandLabel = brand && brand !== "unknown" ? (BRAND_LABELS[brand] || capitalize(brand)) : "Card";
    const fundingLabel = FUNDING_LABELS[funding] || "";
    const last4 = parsed.last4 ? ` (…${parsed.last4})` : "";
    const parts = [brandLabel, fundingLabel].filter(Boolean).join(" ");
    return `${parts}${last4}`;
  }
  return capitalize(type) || "";
}

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "Amex",
  american_express: "Amex",
  discover: "Discover",
  diners: "Diners",
  jcb: "JCB",
  unionpay: "UnionPay",
  union_pay: "UnionPay",
  link: "Link",
  eftpos_au: "EFTPOS",
  cartes_bancaires: "Cartes Bancaires",
  unknown: "",
};

const FUNDING_LABELS: Record<string, string> = {
  credit: "Credit",
  debit: "Debit",
  prepaid: "Prepaid",
  unknown: "",
};

function capitalize(s: string): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
