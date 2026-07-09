import { createContext, useCallback, useEffect, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocalStorage } from "../hooks/useLocalStorage";
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
  Payment,
  Product,
} from "../types";
import { newId } from "../utils/format";
import { fetchOrders, createOrder as apiCreateOrder, updateOrder as apiUpdateOrder, cancelOrder as apiCancelOrder, fetchProducts, createProduct as apiCreateProduct, updateProduct as apiUpdateProduct, deleteProduct as apiDeleteProduct, fetchInventory, createInventoryItem as apiCreateInventoryItem, updateInventoryItem as apiUpdateInventoryItem, deleteInventoryItem as apiDeleteInventoryItem, type ApiProduct, type ApiInventoryItem } from "../utils/api";

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
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  payments: Payment[];
  setPayments: React.Dispatch<React.SetStateAction<Payment[]>>;
  labelTemplates: LabelTemplate[];
  setLabelTemplates: React.Dispatch<React.SetStateAction<LabelTemplate[]>>;
  profile: BusinessProfile;
  setProfile: React.Dispatch<React.SetStateAction<BusinessProfile>>;
  recordPayment: (order: Order) => void;
  deductInventoryForOrder: (order: Order) => void;
  resetAllData: () => void;
  refreshOrders: () => Promise<void>;
  apiCreateOrder: (order: Parameters<typeof apiCreateOrder>[0]) => Promise<{ id: number }>;
  apiUpdateOrder: (id: number, patch: { status?: string; payment_status?: string }) => Promise<void>;
  apiCancelOrder: (id: number) => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [customers, setCustomers] = useLocalStorage<Customer[]>("muyrico_customers", seedCustomers);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useLocalStorage<Payment[]>("muyrico_payments", seedPayments);
  const [labelTemplates, setLabelTemplates] = useLocalStorage<LabelTemplate[]>(
    "muyrico_labels",
    seedLabelTemplates,
  );
  const [profile, setProfile] = useLocalStorage<BusinessProfile>("muyrico_profile", seedProfile);

  const refreshOrders = useCallback(async () => {
    try {
      const raw = await fetchOrders();
      const mapped: Order[] = raw.map((r) => {
        let items: Order["items"] = [];
        try { items = JSON.parse(r.items_json); } catch { /* ignore */ }
        return {
          id: String(r.id),
          orderNumber: `MR-${r.id}`,
          customerId: null,
          customerName: r.customer_name,
          phone: r.phone || "",
          items,
          source: (r.source === "in-person" ? "in-person" : "website") as OrderSource,
          // normalize legacy 'done' → 'completed' for the UI
          status: (r.status === "done" ? "completed" : r.status) as Order["status"],
          paymentMethod: r.payment_method as Order["paymentMethod"],
          paymentStatus: r.payment_status as Order["paymentStatus"],
          subtotal: r.total_cents / 100,
          discount: 0,
          total: r.total_cents / 100,
          dueDate: r.pickup_date,
          createdAt: r.created_at,
          notes: r.notes || "",
          inventoryDeducted: r.status === "done" || r.status === "completed",
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
      display_order: typeof p.display_order === "number" ? p.display_order : 0,
      auto_generate_label: !!p.auto_generate_label,
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

  useEffect(() => {
    refreshInventory();
  }, [refreshInventory]);

  const handleApiCreateOrder = useCallback(async (order: Parameters<typeof apiCreateOrder>[0]) => {
    const result = await apiCreateOrder(order);
    await refreshOrders();
    return result;
  }, [refreshOrders]);

  const handleApiUpdateOrder = useCallback(async (id: number, patch: { status?: string; payment_status?: string }) => {
    await apiUpdateOrder(id, patch);
    await refreshOrders();
  }, [refreshOrders]);

  const handleApiCancelOrder = useCallback(async (id: number) => {
    await apiCancelOrder(id);
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

  const recordPayment = (order: Order) => {
    if (!order.paymentMethod) return;
    setPayments((prev) => [
      {
        id: newId("pay"),
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        amount: order.total,
        method: order.paymentMethod!,
        date: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const deductInventoryForOrder = (order: Order) => {
    setInventory((prevInv) => {
      const updated = [...prevInv];
      for (const item of order.items) {
        const product = products.find((p) => p.id === item.productId);
        if (!product) continue;
        for (const rec of product.recipe) {
          const idx = updated.findIndex((i) => i.id === rec.inventoryItemId);
          if (idx >= 0) {
            const used = rec.qtyPerUnit * item.qty;
            updated[idx] = {
              ...updated[idx],
              quantity: Math.max(0, +(updated[idx].quantity - used).toFixed(2)),
            };
          }
        }
      }
      return updated;
    });
  };

  const resetAllData = () => {
    setCustomers(seedCustomers);
    setPayments(seedPayments);
    setLabelTemplates(seedLabelTemplates);
    setProfile(seedProfile);
    refreshOrders();
    refreshProducts();
    refreshInventory();
  };

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
      setCustomers,
      orders,
      setOrders,
      payments,
      setPayments,
      labelTemplates,
      setLabelTemplates,
      profile,
      setProfile,
      recordPayment,
      deductInventoryForOrder,
      resetAllData,
      refreshOrders,
      apiCreateOrder: handleApiCreateOrder,
      apiUpdateOrder: handleApiUpdateOrder,
      apiCancelOrder: handleApiCancelOrder,
    }),
    [products, inventory, customers, orders, payments, labelTemplates, profile, refreshOrders, refreshProducts, refreshInventory, handleApiCreateOrder, handleApiUpdateOrder, handleApiCancelOrder, handleApiCreateProduct, handleApiUpdateProduct, handleApiDeleteProduct, handleApiCreateInventoryItem, handleApiUpdateInventoryItem, handleApiDeleteInventoryItem],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}
