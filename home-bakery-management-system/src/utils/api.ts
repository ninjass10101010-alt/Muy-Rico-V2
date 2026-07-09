const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = isDev ? "http://localhost:8787" : "";

interface ApiOrderCreate {
  customer_name: string;
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
  patch: { status?: string; payment_status?: string; notes?: string }
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
  active: number;
  ingredients?: string | null;
  allergens?: string | null;
  flavors?: string;
  recipe?: string;
  display_order?: number;
  auto_generate_label?: number;
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
