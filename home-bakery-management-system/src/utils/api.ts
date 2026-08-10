import type { BusinessProfile, FlavorGroup, PackSize, PaymentMethod, RecipeLine } from "../types";

const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const API_BASE = isDev ? "http://localhost:8787" : "";

interface ApiOrderCreate {
  customer_name: string;
  customer_id?: string | null;
  phone?: string | null;
  email?: string | null;
  pickup_date: string;
  pickup_time?: string | null;
  items_json: { name: string; qty: number; price: number }[];
  total_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  payment_method: string;
  payment_status: string;
  status?: string;
  notes?: string | null;
  source?: string;
  food_coloring?: string | null;
  language?: string;
}

interface ApiOrder {
  id: number;
  created_at: string;
  customer_name: string;
  customer_id: string | null;
  phone: string | null;
  pickup_date: string;
  pickup_time: string | null;
  items_json: string;
  total_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  payment_method: string;
  payment_sub_method: string | null;
  payment_status: string;
  status: string;
  notes: string | null;
  created_by: string;
  source: string;
  food_coloring: string | null;
  inventory_deducted?: number;
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
  if (!res.ok) {
    let errorMsg = `API error ${res.status}`;
    let errBody: any = null;
    try {
      errBody = await res.json();
      errorMsg = errBody.error || errorMsg;
    } catch {}
    const err: any = new Error(errorMsg);
    err.status = res.status;
    err.body = errBody;
    throw err;
  }
  const data = await res.json();
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
    payment_sub_method?: string | null;
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
  pack_sizes?: PackSize[] | string;
  recipe?: string | RecipeLine[];
  display_order?: number;
  auto_generate_label?: number | boolean;
  featured?: number | boolean;
  show_online?: number | boolean;
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
  featured?: boolean;
  show_online?: boolean;
}

export type ProductUpdate = Partial<ProductCreate>;

export async function fetchProducts(): Promise<ApiProduct[]> {
  const data = await apiFetch<{ products: ApiProduct[] }>("/api/products?include_hidden=1");
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
  const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}

// ─── Gallery ───────────────────────────────────────────────────────────────

export interface ApiGalleryPhoto {
  id: string;
  product_id: string;
  title: string;
  title_es?: string | null;
  image_url: string;
  active: boolean;
  display_order: number;
  product_name?: string | null;
  product_name_es?: string | null;
  product_emoji?: string | null;
  product_display_order?: number;
}

export interface GalleryPhotoCreate {
  product_id: string;
  title: string;
  title_es?: string | null;
  image_url: string;
  display_order?: number;
  active?: boolean;
}

export type GalleryPhotoUpdate = Partial<GalleryPhotoCreate>;

export async function fetchGalleryAdmin(): Promise<ApiGalleryPhoto[]> {
  const data = await apiFetch<{ photos: ApiGalleryPhoto[] }>("/api/gallery/all");
  return data.photos;
}

export async function createGalleryPhoto(
  p: GalleryPhotoCreate
): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/gallery", {
    method: "POST",
    body: JSON.stringify(p),
  });
}

export async function updateGalleryPhoto(
  id: string,
  patch: GalleryPhotoUpdate
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/gallery/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteGalleryPhoto(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/gallery/${encodeURIComponent(id)}`, {
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
  barcode?: string | null;
  nutrition_source?: string | null;
  nutrition_fetched_at?: string | null;
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
  barcode?: string | null;
  nutrition_source?: string | null;
  nutrition_fetched_at?: string | null;
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

// Lookup by scanned/typed barcode (case-insensitive). 404 if not bound to any active item.
export async function lookupInventoryByCode(
  code: string
): Promise<{ item: ApiInventoryItem } | { error: string; status?: number }> {
  const q = encodeURIComponent(code.trim());
  const url = `${API_BASE}/api/inventory/lookup?code=${q}`;
  try {
    const data = await apiFetch<{ item: ApiInventoryItem }>(url);
    return { item: data.item };
  } catch (err: any) {
    return { error: err?.message || "Lookup failed", status: err?.status || 500 };
  }
}

// Atomic quantity adjust (delta may be negative). Used by the scan modal.
export async function adjustInventoryQuantity(
  id: string,
  delta: number
): Promise<{ ok: boolean; quantity: number } | { error: string }> {
  try {
    const data = await apiFetch<{ ok: boolean; quantity: number }>(
      `${API_BASE}/api/inventory/${encodeURIComponent(id)}/adjust`,
      { method: "POST", body: JSON.stringify({ delta }) }
    );
    return { ok: true, quantity: Number(data.quantity) };
  } catch (err: any) {
    return { error: err?.message || "Adjust failed" };
  }
}

// ─── Inventory enrichment (USDA FoodData Central + Open Food Facts) ──────────

export interface UsdaCandidate {
  fdcId: number;
  name: string;
  dataType: string;
  ingredients: string | null;
  foodCategory: string | null;
  portionGramWeight: number | null;
  per100g: { energy?: number; protein?: number; carbs?: number; fat?: number } | null;
  allergenHints: string[];
}

export interface OffProduct {
  name: string;
  brand: string | null;
  ingredients: string | null;
  allergens: string[];
  quantity: string | null;
  unitWeightLb: number | null;
  imageUrl: string | null;
}

export interface UsdaLookupResponse {
  candidates: UsdaCandidate[];
  demo?: boolean; // true when the worker fell back to DEMO_KEY (30 req/hr limit)
}

export async function lookupUsdaIngredient(
  q: string,
  limit = 5
): Promise<UsdaLookupResponse> {
  const params = new URLSearchParams({ q, limit: String(limit) });
  return apiFetch(`/api/inventory/lookup-ingredient?${params.toString()}`);
}

export async function enrichBarcode(
  code: string
): Promise<{ source: "off"; product: OffProduct | null }> {
  const params = new URLSearchParams({ code });
  return apiFetch(`/api/inventory/enrich?${params.toString()}`);
}

// ─── Scan audit trail ────────────────────────────────────────────────────────

export interface ScanEvent {
  id: number;
  inventory_id: string | null;
  code: string;
  action: string; // lookup|miss|bind|unbind|adjust|create|conflict|enrich_off|...
  delta: number | null;
  actor: string | null;
  source: string | null;
  meta: string | null;
  created_at: string;
}

export async function fetchScanHistory(
  inventoryId?: string,
  limit = 50
): Promise<ScanEvent[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const url = inventoryId
    ? `/api/inventory/${encodeURIComponent(inventoryId)}/scan-history`
    : "/api/inventory/scan-history";
  const data = await apiFetch<{ events: ScanEvent[] }>(`${url}?${params.toString()}`);
  return data.events;
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

export interface DuplicatePair {
  survivingCandidate: ApiCustomer;
  mergedCandidate: ApiCustomer;
  matchedBy: string;
  confidence: string;
}

export async function apiGetDuplicateCustomers(): Promise<DuplicatePair[]> {
  const data = await apiFetch<{ duplicates: DuplicatePair[] }>("/api/customers/duplicates");
  return data.duplicates || [];
}

export async function apiMergeCustomers(
  survivingId: string,
  mergedId: string
): Promise<{ ok: boolean; survivingId: string; relinkedOrderCount: number }> {
  return apiFetch("/api/customers/merge", {
    method: "POST",
    body: JSON.stringify({ survivingId, mergedId }),
  });
}

export async function apiReverseMerge(mergeId: string): Promise<{ ok: boolean; restoredId: string }> {
  return apiFetch(`/api/customers/merge/${mergeId}/reverse`, {
    method: "POST",
  });
}

export async function apiRelinkOrder(
  orderId: number,
  customerId: string | null
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ customer_id: customerId }),
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
  methodDetails: string | null;
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

// ─── Receipts ─────────────────────────────────────────────────────────────────

export interface ApiReceipt {
  id: string;
  orderId: number;
  orderNumber: string | null;
  customerName: string;
  email: string | null;
  itemsJson: string;
  totalCents: number;
  paymentMethod: string;
  paymentSubMethod: string | null;
  orderStatus: string;
  status: "sent" | "failed";
  messageId: string | null;
  sentAt: string;
  createdAt: string;
}

export async function fetchReceipts(filters?: {
  order_id?: string;
  email?: string;
  search?: string;
}): Promise<ApiReceipt[]> {
  const params = new URLSearchParams();
  if (filters?.order_id) params.set("order_id", filters.order_id);
  if (filters?.email) params.set("email", filters.email);
  if (filters?.search) params.set("search", filters.search);
  params.set("limit", "500");
  const qs = params.toString();
  const data = await apiFetch<{ receipts: ApiReceipt[] }>(`/api/receipts${qs ? `?${qs}` : ""}`);
  return data.receipts;
}

export async function resendReceiptApi(id: string): Promise<{ ok: boolean; status: string; messageId: string | null }> {
  return apiFetch(`/api/receipts/${encodeURIComponent(id)}/resend`, { method: "POST" });
}

export async function generateReceiptApi(orderId: number): Promise<{ ok: boolean; receiptId: string; status: string; messageId: string | null }> {
  return apiFetch(`/api/orders/${orderId}/generate-receipt`, { method: "POST" });
}

export function receiptHtmlUrl(receiptId: string): string {
  return `${API_BASE}/api/receipts/${encodeURIComponent(receiptId)}/html`;
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
  netWeightUS: string | null;
  netWeightMetric: string | null;
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
  orientation: string | null;
  websiteUrl: string | null;
  elements: string | null;
  disclaimerVariant: string | null;
  productType: string | null;
  allergenTags: string | null;
  noAllergensConfirmed: number | null;
  nutrientClaim: number | null;
  bgImage: string | null;
  averyPreset: string | null;
  bestByDate: string | null;
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
  netWeightUS?: string | null;
  netWeightMetric?: string | null;
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
  orientation?: string | null;
  websiteUrl?: string | null;
  elements?: unknown;
  disclaimerVariant?: string | null;
  productType?: string | null;
  allergenTags?: string[];
  noAllergensConfirmed?: boolean | null;
  nutrientClaim?: boolean | null;
  bgImage?: string | null;
  averyPreset?: string | null;
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
  website: string | null;
  registrationNumber: string | null;
  businessType: string | null;
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

export async function generateOrderLabels(orderId: number): Promise<{ ok: boolean; orderId: number; generated: number }> {
  return apiFetch(`/api/orders/${orderId}/generate-labels`, { method: "POST" });
}

export async function backfillAllOrderLabels(): Promise<{ ok: boolean; ordersProcessed: number; labelsGenerated: number }> {
  return apiFetch("/api/orders/backfill-labels", { method: "POST" });
}

// ─── Site content + testimonials (homepage editing) ───────────────────────────

export interface SiteContentEntry {
  value_en?: string | null;
  value_es?: string | null;
  image_url?: string | null;
}

export type SiteContentMap = Record<string, SiteContentEntry>;

export interface ApiTestimonial {
  id: string;
  quote_en: string;
  quote_es?: string | null;
  author?: string | null;
  occasion?: string | null;
  published: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string | null;
}

export interface TestimonialCreate {
  quote_en: string;
  quote_es?: string;
  author?: string;
  occasion?: string;
  published?: boolean;
  display_order?: number;
}

export type TestimonialUpdate = Partial<TestimonialCreate>;

export async function fetchSite(): Promise<{ content: SiteContentMap; testimonials: ApiTestimonial[] }> {
  return apiFetch("/api/site");
}

export async function saveSiteContent(
  content: SiteContentMap
): Promise<{ ok: boolean; updated: number }> {
  return apiFetch("/api/site", { method: "PUT", body: JSON.stringify({ content }) });
}

export async function fetchTestimonials(): Promise<ApiTestimonial[]> {
  const data = await apiFetch<{ testimonials: ApiTestimonial[] }>("/api/testimonials");
  return data.testimonials;
}

export async function createTestimonial(t: TestimonialCreate): Promise<{ ok: boolean; id: string }> {
  return apiFetch("/api/testimonials", { method: "POST", body: JSON.stringify(t) });
}

export async function updateTestimonial(id: string, patch: TestimonialUpdate): Promise<{ ok: boolean }> {
  return apiFetch(`/api/testimonials/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export async function deleteTestimonial(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/testimonials/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ─── Inventory deduction ────────────────────────────────────────────────────

export async function deductInventory(orderId: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/orders/${orderId}/deduct`, { method: "POST" });
}

// ─── Gallery (alias) ────────────────────────────────────────────────────────

export const fetchGalleryPhotos = fetchGalleryAdmin;

// ─── Quotes ────────────────────────────────────────────────────────────────

export interface ApiQuoteItem {
  id: number;
  product_type: 'cake' | 'cakepops' | 'cupcakes';
  details: Record<string, any>;
  reference_image_url?: string | null;
}

export interface ApiQuote {
  id: number;
  status: string;
  customer_name: string;
  email: string;
  phone: string | null;
  language: string;
  occasion: string | null;
  serving_size: string | null;
  cake_flavor: string;
  filling: string | null;
  frosting: string | null;
  toppings?: string[];
  dietary?: string[];
  reference_image_url: string | null;
  comments: string | null;
  desired_date: string | null;
  budget: string | null;
  quoted_price: number | null;
  admin_notes: string | null;
  converted_order_id: number | null;
  items?: ApiQuoteItem[];
  created_at: string;
  updated_at: string;
}

export async function fetchQuotes(): Promise<ApiQuote[]> {
  const data = await apiFetch<{ quotes: ApiQuote[] }>("/api/quotes");
  return data.quotes;
}

export async function updateQuote(
  id: number,
  patch: { quoted_price?: number | null; admin_notes?: string | null; status?: string }
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quotes/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteQuote(id: number): Promise<{ ok: boolean }> {
  return apiFetch(`/api/quotes/${id}`, { method: "DELETE" });
}

export async function convertQuote(
  id: number,
  deposit_amount_cents: number,
  payment_method: string
): Promise<{ ok: boolean; order_id: number; payment_status: string }> {
  return apiFetch(`/api/quotes/${id}/convert`, {
    method: "POST",
    body: JSON.stringify({ deposit_amount_cents, payment_method }),
  });
}

export async function uploadQuoteImage(file: File): Promise<{ url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/api/quotes/upload-image`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Upload failed');
  }
  return res.json();
}
