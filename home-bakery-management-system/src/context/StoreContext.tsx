import { createContext, useCallback, useEffect, useContext, useMemo, useState, type ReactNode } from "react";
import {
  seedCustomers,
  seedInventory,
  seedLabelTemplates,
  seedPayments,
  seedProducts,
  seedProfile,
} from "../data/seedData";
import type {
  BusinessProfile,
  Customer,
  FlavorGroup,
  InventoryItem,
  LabelTemplate,
  Order,
  OrderSource,
  PackSize,
  Payment,
  Product,
  Quote,
  Receipt,
} from "../types";
import { newId } from "../utils/format";
import { fetchOrders, createOrder as apiCreateOrder, updateOrder as apiUpdateOrder, cancelOrder as apiCancelOrder, deleteOrder as apiDeleteOrder, fetchProducts, createProduct as apiCreateProduct, updateProduct as apiUpdateProduct, deleteProduct as apiDeleteProduct, fetchInventory, createInventoryItem as apiCreateInventoryItem, updateInventoryItem as apiUpdateInventoryItem, deleteInventoryItem as apiDeleteInventoryItem, fetchCustomers, createCustomer as apiCreateCustomer, updateCustomer as apiUpdateCustomer, deleteCustomer as apiDeleteCustomer, fetchPayments, createPayment as apiCreatePayment, fetchLabelTemplates, createLabelTemplate as apiCreateLabelTemplate, updateLabelTemplate as apiUpdateLabelTemplate, deleteLabelTemplate as apiDeleteLabelTemplate, fetchProfile, updateProfile as apiUpdateProfile, resetSeedData, fetchReceipts, resendReceiptApi, generateReceiptApi, deductInventory as deductInventoryFromApi, fetchQuotes, updateQuote as apiUpdateQuote, convertQuote as apiConvertQuote, type ApiProduct, type ApiInventoryItem, type ApiCustomer, type ApiPayment, type ApiLabelTemplate, type ApiBusinessProfile, type ApiReceipt, type ApiQuote } from "../utils/api";

interface StoreContextValue {
  products: Product[];
  setProducts: React.Dispatch<React.SetStateAction<Product[]>>;
  refreshProducts: () => Promise<void>;
  apiCreateProduct: (p: Parameters<typeof apiCreateProduct>[0]) => Promise<{ id: string }>;
  apiUpdateProduct: (id: string, patch: Parameters<typeof apiUpdateProduct>[1]) => Promise<void>;
  apiDeleteProduct: (id: string) => Promise<void>;
  inventory: InventoryItem[];
  setInventory: React.Dispatch<React.SetStateAction<InventoryItem[]>>;
  refreshInventory: () => Promise<void>;
  apiCreateInventoryItem: (item: Parameters<typeof apiCreateInventoryItem>[0]) => Promise<{ id: string }>;
  apiUpdateInventoryItem: (id: string, patch: Parameters<typeof apiUpdateInventoryItem>[1]) => Promise<void>;
  apiDeleteInventoryItem: (id: string) => Promise<void>;
  customers: Customer[];
  handleCreateCustomer: (c: Parameters<typeof apiCreateCustomer>[0]) => Promise<{ ok: boolean; id: string }>;
  handleUpdateCustomer: (id: string, patch: Parameters<typeof apiUpdateCustomer>[1]) => Promise<void>;
  handleDeleteCustomer: (id: string) => Promise<void>;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  payments: Payment[];
  refreshPayments: () => Promise<void>;
  receipts: Receipt[];
  refreshReceipts: () => Promise<void>;
  resendReceipt: (id: string) => Promise<void>;
  generateReceipt: (orderId: number) => Promise<void>;
  labelTemplates: LabelTemplate[];
  handleCreateLabel: (t: Parameters<typeof apiCreateLabelTemplate>[0]) => Promise<{ ok: boolean; id: string }>;
  handleUpdateLabel: (id: string, patch: Parameters<typeof apiUpdateLabelTemplate>[1]) => Promise<void>;
  handleDeleteLabel: (id: string) => Promise<void>;
  profile: BusinessProfile;
  handleUpdateProfile: (draft: BusinessProfile) => Promise<void>;
  recordPayment: (order: Order) => Promise<void>;
  loading: boolean;
  apiDeductInventory: (orderId: number) => Promise<void>;
  resetAllData: () => Promise<void>;
  refreshOrders: () => Promise<void>;
  apiCreateOrder: (order: Parameters<typeof apiCreateOrder>[0]) => Promise<{ id: number }>;
  apiUpdateOrder: (id: number, patch: { status?: string; payment_status?: string; payment_method?: string; payment_sub_method?: string | null }) => Promise<void>;
  apiCancelOrder: (id: number) => Promise<void>;
  apiDeleteOrder: (id: number) => Promise<void>;
  quotes: Quote[];
  refreshQuotes: () => Promise<void>;
  handleUpdateQuote: (id: number, patch: { quoted_price?: number | null; admin_notes?: string | null; status?: string }) => Promise<void>;
  handleConvertQuote: (id: number, depositAmountCents: number, paymentMethod: string) => Promise<{ orderId: number; paymentStatus: string }>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [labelTemplates, setLabelTemplates] = useState<LabelTemplate[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [profile, setProfile] = useState<BusinessProfile>(seedProfile);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshOrders = useCallback(async () => {
    try {
      const raw = await fetchOrders();
      const mapped: Order[] = raw.map((r) => {
        let items: Order["items"] = [];
        try { items = JSON.parse(r.items_json); } catch { /* ignore */ }
        return {
          id: String(r.id),
          orderNumber: `MR-${r.id}`,
          customerId: r.customer_id || null,
          customerName: r.customer_name,
          phone: r.phone || "",
          items,
          source: (r.source === "in-person" ? "in-person" : "website") as OrderSource,
          // normalize legacy 'done' → 'completed' for the UI
          status: (r.status === "done" ? "completed" : r.status) as Order["status"],
          paymentMethod: r.payment_method as Order["paymentMethod"],
          paymentSubMethod: r.payment_sub_method || null,
          paymentStatus: r.payment_status as Order["paymentStatus"],
          subtotal: r.total_cents / 100,
          discount: 0,
          total: r.total_cents / 100,
          dueDate: r.pickup_date,
          createdAt: r.created_at,
          notes: r.notes || "",
          inventoryDeducted: r.inventory_deducted === 1 || r.inventory_deducted === true,
          foodColoring: r.food_coloring || null,
        };
      });
      setOrders(mapped);
    } catch (err) {
      console.warn("Failed to fetch orders from API:", err);
    }
  }, []);

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  // ─── Products ─────────────────────────────────────────────────────────────

  function apiToProduct(p: ApiProduct): Product {
    let flavor_groups: FlavorGroup[] = [];
    if (p.flavor_groups) {
      if (Array.isArray(p.flavor_groups)) flavor_groups = p.flavor_groups;
    }
    let pack_sizes: PackSize[] = [];
    if (p.pack_sizes) {
      if (Array.isArray(p.pack_sizes)) pack_sizes = p.pack_sizes;
      else {
        try {
          const parsed = JSON.parse(p.pack_sizes);
          if (Array.isArray(parsed)) pack_sizes = parsed;
        } catch { pack_sizes = []; }
      }
    }
    let recipe: Product["recipe"] = [];
    if (p.recipe) {
      try {
        const parsed = typeof p.recipe === "string" ? JSON.parse(p.recipe) : p.recipe;
        if (Array.isArray(parsed)) recipe = parsed;
      }
      catch { recipe = []; }
    }
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      price: Number(p.price) || 0,
      cost: Number(p.cost) || 0,
      sku: p.sku || "",
      emoji: p.emoji,
      active: !!p.active,
      description: p.description || "",
      ingredients: p.ingredients || "",
      allergens: p.allergens || "",
      recipe,
      name_es: p.name_es || undefined,
      description_es: p.description_es || undefined,
      image_url: p.image_url || undefined,
      flavor_groups: flavor_groups.length ? flavor_groups : undefined,
      pack_sizes: pack_sizes.length ? pack_sizes : undefined,
      display_order: typeof p.display_order === "number" ? p.display_order : 0,
      auto_generate_label: !!p.auto_generate_label,
      featured: !!(p as any).featured,
      show_online: p.show_online === undefined ? true : !!p.show_online,
      flavor_deduction_map: p.flavor_deduction_map || null,
    };
  }

  const refreshProducts = useCallback(async () => {
    try {
      const rows = await fetchProducts();
      setProducts(rows.map(apiToProduct));
    } catch (err) {
      console.warn("Failed to fetch products from API, falling back to seeds:", err);
      setProducts(seedProducts);
    }
  }, []);

  useEffect(() => {
    refreshProducts();
  }, [refreshProducts]);

  // ─── Inventory ───────────────────────────────────────────────────────────

  function apiToInventoryItem(row: ApiInventoryItem): InventoryItem {
    let allergens: string[] = [];
    if (row.allergens) {
      try {
        const parsed = JSON.parse(row.allergens);
        if (Array.isArray(parsed)) allergens = parsed;
      } catch { allergens = []; }
    }
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      quantity: Number(row.quantity) || 0,
      unit: row.unit,
      reorderLevel: Number(row.reorder_level) || 0,
      costPerUnit: Number(row.cost_per_unit) || 0,
      supplier: row.supplier || "",
      ingredients_label: row.ingredients_label || undefined,
      allergens: allergens.length ? allergens : undefined,
      unit_weight: typeof row.unit_weight === "number" ? row.unit_weight : undefined,
      active: !!row.active,
    };
  }

  const refreshInventory = useCallback(async () => {
    try {
      const rows = await fetchInventory();
      setInventory(rows.map(apiToInventoryItem));
    } catch (err) {
      console.warn("Failed to fetch inventory from API, falling back to seeds:", err);
      setInventory(seedInventory);
    }
  }, []);

  // ─── Customers ───────────────────────────────────────────────────────────

  function apiToCustomer(row: ApiCustomer): Customer {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone || "",
      email: row.email || "",
      notes: row.notes || "",
      createdAt: row.createdAt,
      active: Boolean(row.active),
    };
  }

  const refreshCustomers = useCallback(async () => {
    try {
      const rows = await fetchCustomers();
      setCustomers(rows.map(apiToCustomer));
    } catch (err) {
      console.warn("Failed to fetch customers from API, falling back to seeds:", err);
      setCustomers(seedCustomers);
    }
  }, []);

  // ─── Payments ─────────────────────────────────────────────────────────────

  function apiToPayment(row: ApiPayment): Payment {
    return {
      id: row.id,
      orderId: row.orderId ? String(row.orderId) : "",
      orderNumber: row.orderNumber || "",
      customerName: row.customerName,
      amount: Number(row.amount) || 0,
      method: row.method,
      methodDetails: row.methodDetails || null,
      date: row.date,
      active: Boolean(row.active),
    };
  }

  function apiToReceipt(row: ApiReceipt): Receipt {
    return {
      id: row.id,
      orderId: String(row.orderId),
      orderNumber: row.orderNumber || "",
      customerName: row.customerName,
      email: row.email,
      itemsJson: row.itemsJson,
      totalCents: row.totalCents,
      paymentMethod: row.paymentMethod,
      paymentSubMethod: row.paymentSubMethod,
      orderStatus: row.orderStatus,
      status: row.status,
      messageId: row.messageId,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    };
  }

  const refreshPayments = useCallback(async () => {
    try {
      const rows = await fetchPayments();
      setPayments(rows.map(apiToPayment));
    } catch (err) {
      console.warn("Failed to fetch payments from API, falling back to seeds:", err);
      setPayments(seedPayments);
    }
  }, []);

  const refreshReceipts = useCallback(async () => {
    try {
      const rows = await fetchReceipts();
      setReceipts(rows.map(apiToReceipt));
    } catch (err) {
      console.warn("Failed to fetch receipts from API:", err);
      setReceipts([]);
    }
  }, []);

  // ─── Quotes ────────────────────────────────────────────────────────────

  function apiToQuote(row: ApiQuote): Quote {
    return {
      id: row.id,
      status: row.status as Quote["status"],
      customerName: row.customer_name,
      email: row.email,
      phone: row.phone,
      language: (row.language || "es") as Quote["language"],
      occasion: row.occasion,
      servingSize: row.serving_size,
      cakeFlavor: row.cake_flavor,
      filling: row.filling,
      frosting: row.frosting,
      toppings: Array.isArray(row.toppings) ? row.toppings : [],
      dietary: Array.isArray(row.dietary) ? row.dietary : [],
      referenceImageUrl: row.reference_image_url,
      comments: row.comments,
      desiredDate: row.desired_date,
      budget: row.budget,
      quotedPrice: row.quoted_price,
      adminNotes: row.admin_notes,
      convertedOrderId: row.converted_order_id,
      items: Array.isArray(row.items) ? row.items : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  const refreshQuotes = useCallback(async () => {
    try {
      const rows = await fetchQuotes();
      setQuotes(rows.map(apiToQuote));
    } catch (err) {
      console.warn("Failed to fetch quotes from API:", err);
      setQuotes([]);
    }
  }, []);

  // ─── Label templates ──────────────────────────────────────────────────────

  function apiToLabelTemplate(row: ApiLabelTemplate): LabelTemplate {
    let elements: LabelTemplate["elements"] = [];
    if (row.elements) {
      try {
        const parsed = typeof row.elements === "string" ? JSON.parse(row.elements) : row.elements;
        if (Array.isArray(parsed)) elements = parsed;
      } catch {
        elements = [];
      }
    }
    let allergenTags: string[] = [];
    if (row.allergenTags) {
      try {
        const parsed = typeof row.allergenTags === "string" ? JSON.parse(row.allergenTags) : row.allergenTags;
        if (Array.isArray(parsed)) allergenTags = parsed;
      } catch { /* ignore */ }
    }
    return {
      id: row.id,
      name: row.name,
      shape: (row.shape as LabelTemplate["shape"]) || "rounded",
      bgColor: row.bgColor || "#FBF3E7",
      accentColor: row.accentColor || "#C17A3F",
      textColor: row.textColor || "#4A3222",
      businessName: row.businessName || "",
      productName: row.productName || "",
      details: row.details || "",
      ingredients: row.ingredients || "",
      allergens: row.allergens || "",
      netWeight: row.netWeight || "",
      netWeightUS: row.netWeightUS || "",
      netWeightMetric: row.netWeightMetric || "",
      price: row.price || "",
      showPrice: Boolean(row.showPrice),
      showBestBy: Boolean(row.showBestBy),
      bestByDays: Number(row.bestByDays) || 0,
      logoEmoji: row.logoEmoji || "",
      logoImage: row.logoImage || undefined,
      logoSize: Number(row.logoSize) || 16,
      font: row.font || "'Cormorant Garamond', Georgia, serif",
      businessIdMode: (row.businessIdMode as LabelTemplate["businessIdMode"]) || "address",
      address: row.address || "",
      phoneNumber: row.phoneNumber || "",
      registrationNumber: row.registrationNumber || "",
      showDisclaimer: row.showDisclaimer === null || row.showDisclaimer === undefined ? true : Boolean(row.showDisclaimer),
      labelWidth: Number(row.labelWidth) || 3,
      labelHeight: Number(row.labelHeight) || 4,
      orientation: (row.orientation as LabelTemplate["orientation"]) || "portrait",
      websiteUrl: row.websiteUrl || "",
      elements,
      disclaimerVariant: "standard",
      productType: row.productType === "wedding" ? "wedding" : "standard",
      allergenTags,
      noAllergensConfirmed: Boolean(row.noAllergensConfirmed),
      nutrientClaim: Boolean(row.nutrientClaim),
      bgImage: row.bgImage || undefined,
      averyPreset: (row.averyPreset as LabelTemplate["averyPreset"]) || "single",
      active: Boolean(row.active),
    };
  }

  const refreshLabelTemplates = useCallback(async () => {
    try {
      const rows = await fetchLabelTemplates();
      setLabelTemplates(rows.map(apiToLabelTemplate));
    } catch (err) {
      console.warn("Failed to fetch label templates from API, falling back to seeds:", err);
      setLabelTemplates(seedLabelTemplates);
    }
  }, []);

  // ─── Business profile ──────────────────────────────────────────────────────

  function apiToProfile(row: ApiBusinessProfile): BusinessProfile {
    let accepted = seedProfile.acceptedMethods;
    try {
      if (row.acceptedMethods) accepted = JSON.parse(row.acceptedMethods) as BusinessProfile["acceptedMethods"];
    } catch {
      /* keep seed */
    }
    return {
      name: row.name || seedProfile.name,
      tagline: row.tagline || seedProfile.tagline,
      address: row.address || seedProfile.address,
      phone: row.phone || seedProfile.phone,
      email: row.email || seedProfile.email,
      website: row.website || seedProfile.website,
      registrationNumber: row.registrationNumber || seedProfile.registrationNumber,
      businessType: row.businessType === "licensed" ? "licensed" : "cottage",
      acceptedMethods: accepted,
      cashtag: row.cashtag || seedProfile.cashtag,
      venmoHandle: row.venmoHandle || seedProfile.venmoHandle,
      applePayEnabled: Boolean(row.applePayEnabled),
      stripeConnected: Boolean(row.stripeConnected),
    };
  }

  const refreshProfile = useCallback(async () => {
    try {
      const p = await fetchProfile();
      if (p) setProfile(apiToProfile(p));
      else setProfile(seedProfile);
    } catch (err) {
      console.warn("Failed to fetch profile from API, falling back to seed:", err);
      setProfile(seedProfile);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshOrders(),
      refreshProducts(),
      refreshInventory(),
      refreshCustomers(),
      refreshPayments(),
      refreshReceipts(),
      refreshLabelTemplates(),
      refreshProfile(),
      refreshQuotes(),
    ]);
  }, [refreshOrders, refreshProducts, refreshInventory, refreshCustomers, refreshPayments, refreshReceipts, refreshLabelTemplates, refreshProfile, refreshQuotes]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await refreshAll();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  useEffect(() => {
    refreshInventory();
  }, [refreshInventory]);

  const handleApiCreateOrder = useCallback(async (order: Parameters<typeof apiCreateOrder>[0]) => {
    const result = await apiCreateOrder(order);
    await refreshOrders();
    return result;
  }, [refreshOrders]);

  const handleApiUpdateOrder = useCallback(async (id: number, patch: { status?: string; payment_status?: string; payment_method?: string; payment_sub_method?: string | null }) => {
    await apiUpdateOrder(id, patch);
    await refreshOrders();
  }, [refreshOrders]);

  const handleApiCancelOrder = useCallback(async (id: number) => {
    await apiCancelOrder(id);
    await refreshOrders();
  }, [refreshOrders]);

  const handleApiDeleteOrder = useCallback(async (id: number) => {
    await apiDeleteOrder(id);
    await refreshOrders();
  }, [refreshOrders]);

  const handleApiCreateProduct = useCallback(async (p: Parameters<typeof apiCreateProduct>[0]) => {
    const result = await apiCreateProduct(p);
    await refreshProducts();
    return result;
  }, [refreshProducts]);

  const handleApiUpdateProduct = useCallback(async (id: string, patch: Parameters<typeof apiUpdateProduct>[1]) => {
    await apiUpdateProduct(id, patch);
    await refreshProducts();
  }, [refreshProducts]);

  const handleApiDeleteProduct = useCallback(async (id: string) => {
    await apiDeleteProduct(id);
    await refreshProducts();
  }, [refreshProducts]);

  const handleApiCreateInventoryItem = useCallback(async (item: Parameters<typeof apiCreateInventoryItem>[0]) => {
    const result = await apiCreateInventoryItem(item);
    await refreshInventory();
    return result;
  }, [refreshInventory]);

  const handleApiUpdateInventoryItem = useCallback(async (id: string, patch: Parameters<typeof apiUpdateInventoryItem>[1]) => {
    await apiUpdateInventoryItem(id, patch);
    await refreshInventory();
  }, [refreshInventory]);

  const handleApiDeleteInventoryItem = useCallback(async (id: string) => {
    await apiDeleteInventoryItem(id);
    await refreshInventory();
  }, [refreshInventory]);

  const handleCreateCustomer = useCallback(async (c: Parameters<typeof apiCreateCustomer>[0]) => {
    const result = await apiCreateCustomer(c);
    await refreshCustomers();
    return result;
  }, [refreshCustomers]);

  const handleUpdateCustomer = useCallback(async (id: string, patch: Parameters<typeof apiUpdateCustomer>[1]) => {
    await apiUpdateCustomer(id, patch);
    await refreshCustomers();
  }, [refreshCustomers]);

  const handleDeleteCustomer = useCallback(async (id: string) => {
    await apiDeleteCustomer(id);
    await refreshCustomers();
  }, [refreshCustomers]);

  const handleCreateLabel = useCallback(async (t: Parameters<typeof apiCreateLabelTemplate>[0]) => {
    const result = await apiCreateLabelTemplate(t);
    await refreshLabelTemplates();
    return result;
  }, [refreshLabelTemplates]);

  const handleUpdateLabel = useCallback(async (id: string, patch: Parameters<typeof apiUpdateLabelTemplate>[1]) => {
    await apiUpdateLabelTemplate(id, patch);
    await refreshLabelTemplates();
  }, [refreshLabelTemplates]);

  const handleDeleteLabel = useCallback(async (id: string) => {
    await apiDeleteLabelTemplate(id);
    await refreshLabelTemplates();
  }, [refreshLabelTemplates]);

  const handleUpdateProfile = useCallback(async (draft: BusinessProfile) => {
    await apiUpdateProfile(draft);
    await refreshProfile();
  }, [refreshProfile]);

  const recordPayment = useCallback(async (order: Order) => {
    if (!order.paymentMethod) return;
    try {
      await apiCreatePayment({
        id: newId("pay"),
        orderId: Number(order.id) || null,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        amount: order.total,
        method: order.paymentMethod,
        date: new Date().toISOString(),
      });
      await refreshPayments();
    } catch (err) {
      console.warn("Failed to record payment to API:", err);
    }
  }, [refreshPayments]);

  const resendReceipt = useCallback(async (id: string) => {
    try {
      await resendReceiptApi(id);
      await refreshReceipts();
    } catch (err) {
      console.warn("Failed to resend receipt:", err);
    }
  }, [refreshReceipts]);

  const generateReceipt = useCallback(async (orderId: number) => {
    try {
      await generateReceiptApi(orderId);
      await refreshReceipts();
    } catch (err) {
      console.error("Failed to generate receipt:", err);
      throw err;
    }
  }, [refreshReceipts]);

  const resetAllData = useCallback(async () => {
    try {
      await resetSeedData();
    } catch (err) {
      console.warn("Failed to reset seed data on API:", err);
    }
    await refreshAll();
  }, [refreshAll]);

  const apiDeductInventory = useCallback(async (orderId: number) => {
    await deductInventoryFromApi(orderId);
    await refreshInventory();
    await refreshOrders();
  }, [refreshInventory, refreshOrders]);

  const handleUpdateQuote = useCallback(async (id: number, patch: { quoted_price?: number | null; admin_notes?: string | null; status?: string }) => {
    await apiUpdateQuote(id, patch);
    await refreshQuotes();
  }, [refreshQuotes]);

  const handleConvertQuote = useCallback(async (id: number, depositAmountCents: number, paymentMethod: string) => {
    const result = await apiConvertQuote(id, depositAmountCents, paymentMethod);
    await Promise.all([refreshQuotes(), refreshOrders()]);
    return { orderId: result.order_id, paymentStatus: result.payment_status };
  }, [refreshQuotes, refreshOrders]);

  const value = useMemo(
    () => ({
      products,
      setProducts,
      refreshProducts,
      apiCreateProduct: handleApiCreateProduct,
      apiUpdateProduct: handleApiUpdateProduct,
      apiDeleteProduct: handleApiDeleteProduct,
      inventory,
      setInventory,
      refreshInventory,
      apiCreateInventoryItem: handleApiCreateInventoryItem,
      apiUpdateInventoryItem: handleApiUpdateInventoryItem,
      apiDeleteInventoryItem: handleApiDeleteInventoryItem,
      customers,
      handleCreateCustomer,
      handleUpdateCustomer,
      handleDeleteCustomer,
      orders,
      setOrders,
      payments,
      refreshPayments,
      receipts,
      refreshReceipts,
      resendReceipt,
      generateReceipt,
      labelTemplates,
      refreshLabelTemplates,
      handleCreateLabel,
      handleUpdateLabel,
      handleDeleteLabel,
      profile,
      handleUpdateProfile,
      recordPayment,
      loading,
      apiDeductInventory,
      resetAllData,
      refreshOrders,
      apiCreateOrder: handleApiCreateOrder,
      apiUpdateOrder: handleApiUpdateOrder,
      apiCancelOrder: handleApiCancelOrder,
      apiDeleteOrder: handleApiDeleteOrder,
      quotes,
      refreshQuotes,
      handleUpdateQuote,
      handleConvertQuote,
    }),
    [products, inventory, customers, orders, payments, receipts, labelTemplates, refreshLabelTemplates, profile, loading, refreshOrders, refreshProducts, refreshInventory, apiDeductInventory, handleApiCreateOrder, handleApiUpdateOrder, handleApiCancelOrder, handleApiDeleteOrder, handleApiCreateProduct, handleApiUpdateProduct, handleApiDeleteProduct, handleApiCreateInventoryItem, handleApiUpdateInventoryItem, handleApiDeleteInventoryItem, handleCreateCustomer, handleUpdateCustomer, handleDeleteCustomer, handleCreateLabel, handleUpdateLabel, handleDeleteLabel, handleUpdateProfile, refreshReceipts, resendReceipt, generateReceipt, quotes, refreshQuotes, handleUpdateQuote, handleConvertQuote],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
