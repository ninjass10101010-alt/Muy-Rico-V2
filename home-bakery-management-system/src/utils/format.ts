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
  cashapp: "Cash App",
  venmo: "Venmo",
  applepay: "Apple Pay",
  cash: "Cash",
};

export const PAYMENT_METHOD_COLORS: Record<string, string> = {
  stripe: "#635BFF",
  cashapp: "#00D632",
  venmo: "#3D95CE",
  applepay: "#111111",
  cash: "#2E7D32",
};
