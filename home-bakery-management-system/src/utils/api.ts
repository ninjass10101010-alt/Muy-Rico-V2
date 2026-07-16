import type { BusinessProfile, FlavorGroup, PaymentMethod, RecipeLine } from "../types";

const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = isDev ? "http://localhost:8787" : "";

interface ApiOrderCreate {
  customer_name: string;
  customer_id?: string | null;
  phone?: string | null;
  pickup_date: string;
  pickup_time?: string | null;
  items_json: { name: string; qty: number; price: number }[];
  total_cents: number;
  payment_method: string;
  payment_status: string;
  status?: string;
  notes?: string | null;
  source?: string;
  food_coloring?: string | null;
}

interface ApiOrder {
  id: number;
  created_at: string;
  customer_name: string;
  phone: string | null;
  pickup_date: string;
  pickup_time: string | null;
  items_json: string;
  total_cents: number;
  payment_method: string;
  payment_status: string;
  status: string;
  notes: string | null;
  created_by: string;
  source: string;
  food_coloring: string | null;
}

export interface StatsResponse {
  active: number;
  pending: number;
  ready: number;
  done: number;
  cancelled: number;
  unpaid: number;
  paid: number;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `API error ${res.status}`);
  }
  return data as T;
}

export async function fetchOrders(filters?: {
  status?: string;
  payment?: string;
  payment_status?: string;
  search?: string;
}): Promise<ApiOrder[]> {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.payment) params.set("payment", filters.payment);
  if (filters?.payment_status) params.set("payment_status", filters.payment_status);
  if (filters?.search) params.set("search", filters.search);
  params.set("limit", "500");
  const qs = params.toString();
  const data = await apiFetch<{ orders: ApiOrder[] }>(`/api/orders${qs ? `?${qs}` : ""}`);
  return data.orders;
}

export async function createOrder(order: ApiOrderCreate): Promise<{ ok: boolean; id: number }> {
  return apiFetch("/api/orders", {
    method: "POST",
    body: JSON.stringify(order),
  });
}

export async function updateOrder(
  id: number,
  patch: {
    status?: string;
    payment_status?: string;
    payment_method?: string;
    notes?: string;
  }
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function cancelOrder(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${id}`, {
    method: "DELETE",
  });
}

export async function deleteOrder(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${id}?permanent=true`, {
    method: "DELETE",
  });
}

export async function fetchStats(): Promise<StatsResponse> {
  return apiFetch<StatsResponse>("/api/stats");
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface ApiProduct {
  id: string;
  name: string;
  name_es?: string | null;
  description?: string | null;
  description_es?: string | null;
  category: string;
  price: number;
  cost: number;
  sku?: string | null;
  emoji: string;
  image_url?: string | null;
  active: number | boolean;
  ingredients?: string | null;
  allergens?: string | null;
  flavor_groups?: FlavorGroup[];
  recipe?: string | RecipeLine[];
  display_order?: number;
  auto_generate_label?: number | boolean;
  created_at?: string;
  updated_at?: string | null;
}

export interface ProductCreate {
  id: string;
  name: string;
  name_es?: string;
  description?: string;
  description_es?: string;
  category: string;
  price: number;
  cost?: number;
  sku?: string;
  emoji: string;
  image_url?: string;
  active?: boolean;
  ingredients?: string;
  allergens?: string;
  flavors?: string[] | string;
  recipe?: Array<{ inventoryItemId: string; qtyPerUnit: number }>;
  display_order?: number;
}

export type ProductUpdate = Partial<ProductCreate>;

export async function fetchProducts(): Promise<ApiProduct[]> {
  const data = await apiFetch<{ products: ApiProduct[] }>("/api/products");
  return data.products;
}

export async function createProduct(p: ProductCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/products", {
    method: "POST",
    body: JSON.stringify(p),
  });
}

export async function updateProduct(id: string, patch: ProductUpdate): Promise<{ ok: boolean }> {
  return apiFetch(`/api/products/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteProduct(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/products/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

// ─── Inventory ─────────────────────────────────────────────────────────────

export interface ApiInventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  reorder_level: number;
  cost_per_unit: number;
  supplier?: string | null;
  ingredients_label?: string | null;
  allergens?: string;           // JSON array
  unit_weight?: number | null;
  active: number;
  created_at?: string;
  updated_at?: string | null;
}

export interface InventoryItemCreate {
  id: string;
  name: string;
  category: string;
  quantity?: number;
  unit: string;
  reorder_level?: number;
  cost_per_unit?: number;
  supplier?: string;
  ingredients_label?: string;
  allergens?: string[] | string;
  unit_weight?: number | null;
  active?: boolean;
}

export type InventoryItemUpdate = Partial<InventoryItemCreate>;

export async function fetchInventory(): Promise<ApiInventoryItem[]> {
  const data = await apiFetch<{ inventory: ApiInventoryItem[] }>("/api/inventory");
  return data.inventory;
}

export async function createInventoryItem(
  item: InventoryItemCreate
): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/inventory", {
    method: "POST",
    body: JSON.stringify(item),
  });
}

export async function updateInventoryItem(
  id: string,
  patch: InventoryItemUpdate
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/inventory/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteInventoryItem(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/inventory/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── Customers ───────────────────────────────────────────────────────────────

export interface ApiCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
  active: boolean;
}

export interface CustomerCreate {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export type CustomerUpdate = Partial<CustomerCreate>;

export async function fetchCustomers(): Promise<ApiCustomer[]> {
  const data = await apiFetch<{ customers: ApiCustomer[] }>("/api/customers");
  return data.customers;
}

export async function createCustomer(c: CustomerCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/customers", {
    method: "POST",
    body: JSON.stringify(c),
  });
}

export async function updateCustomer(id: string, patch: CustomerUpdate): Promise<{ ok: boolean }> {
  return apiFetch(`/api/customers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteCustomer(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/customers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export interface ApiPayment {
  id: string;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  createdAt: string;
  active: boolean;
}

export interface PaymentCreate {
  id: string;
  orderId?: number | null;
  orderNumber?: string | null;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  date?: string;
}

export async function fetchPayments(): Promise<ApiPayment[]> {
  const data = await apiFetch<{ payments: ApiPayment[] }>("/api/payments");
  return data.payments;
}

export async function createPayment(p: PaymentCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/payments", {
    method: "POST",
    body: JSON.stringify(p),
  });
}

export async function deletePayment(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/payments/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── Label templates ──────────────────────────────────────────────────────────

export interface ApiLabelTemplate {
  id: string;
  name: string;
  shape: string | null;
  bgColor: string | null;
  accentColor: string | null;
  textColor: string | null;
  businessName: string | null;
  productName: string | null;
  details: string | null;
  ingredients: string | null;
  allergens: string | null;
  netWeight: string | null;
  price: string | null;
  showPrice: number | null;
  showBestBy: number | null;
  bestByDays: number | null;
  logoEmoji: string | null;
  logoImage: string | null;
  logoSize: number | null;
  font: string | null;
  businessIdMode: string | null;
  address: string | null;
  phoneNumber: string | null;
  registrationNumber: string | null;
  showDisclaimer: number | null;
  labelWidth: number | null;
  labelHeight: number | null;
  displayOrder: number;
  active: boolean;
}

export interface LabelTemplateCreate {
  id: string;
  name: string;
  shape?: string | null;
  bgColor?: string | null;
  accentColor?: string | null;
  textColor?: string | null;
  businessName?: string | null;
  productName?: string | null;
  details?: string | null;
  ingredients?: string | null;
  allergens?: string | null;
  netWeight?: string | null;
  price?: string | null;
  showPrice?: boolean | null;
  showBestBy?: boolean | null;
  bestByDays?: number | null;
  logoEmoji?: string | null;
  logoImage?: string | null;
  logoSize?: number | null;
  font?: string | null;
  businessIdMode?: string | null;
  address?: string | null;
  phoneNumber?: string | null;
  registrationNumber?: string | null;
  showDisclaimer?: boolean | null;
  labelWidth?: number | null;
  labelHeight?: number | null;
  displayOrder?: number | null;
}

export type LabelTemplateUpdate = Partial<LabelTemplateCreate>;

export async function fetchLabelTemplates(): Promise<ApiLabelTemplate[]> {
  const data = await apiFetch<{ labelTemplates: ApiLabelTemplate[] }>("/api/labels");
  return data.labelTemplates;
}

export async function createLabelTemplate(t: LabelTemplateCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/labels", {
    method: "POST",
    body: JSON.stringify(t),
  });
}

export async function updateLabelTemplate(id: string, patch: LabelTemplateUpdate): Promise<{ ok: boolean }> {
  return apiFetch(`/api/labels/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteLabelTemplate(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/labels/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ─── Business profile (singleton) ─────────────────────────────────────────────

export interface ApiBusinessProfile {
  id: string;
  name: string | null;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  registrationNumber: string | null;
  acceptedMethods: string | null;
  cashtag: string | null;
  venmoHandle: string | null;
  applePayEnabled: number | null;
  stripeConnected: number | null;
  updatedAt: string | null;
}

export async function fetchProfile(): Promise<ApiBusinessProfile | null> {
  const data = await apiFetch<{ profile: ApiBusinessProfile | null }>("/api/profile");
  return data.profile;
}

export async function updateProfile(p: BusinessProfile): Promise<{ ok: boolean }> {
  return apiFetch("/api/profile", {
    method: "PUT",
    body: JSON.stringify(p),
  });
}

// ─── Seed reset ────────────────────────────────────────────────────────────────

export async function resetSeedData(): Promise<{ ok: boolean }> {
  return apiFetch("/api/seed/reset", {
    method: "POST",
  });
}

// ─── Label generation ──────────────────────────────────────────────────────────

export async function generateOrderLabels(orderId: number): Promise<{ ok: boolean; orderId: number }> {
  return apiFetch(`/api/orders/${orderId}/generate-labels`, { method: "POST" });
}

export async function backfillAllOrderLabels(): Promise<{ ok: boolean; ordersProcessed: number; labelsGenerated: number }> {
  return apiFetch("/api/orders/backfill-labels", { method: "POST" });
}
