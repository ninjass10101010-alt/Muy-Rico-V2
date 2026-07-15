export type PaymentMethod = "stripe" | "cashapp" | "venmo" | "applepay" | "cash";

export type OrderSource = "website" | "in-person";

export type OrderStatus = "pending" | "in-progress" | "ready" | "completed" | "cancelled";

export type PaymentStatus = "paid" | "unpaid" | "partial";

export interface RecipeLine {
  inventoryItemId: string;
  qtyPerUnit: number;
}

export interface FlavorGroup {
  name: string;
  name_es?: string;
  options: string[];
}

export interface PackSize {
  id: string;
  label: string;
  label_es?: string;
  qty: number;
  price: number;
  badge?: string;
  badge_es?: string;
  unit_label?: string;
  unit_label_es?: string;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  sku: string;
  emoji: string;
  active: boolean;
  description: string;
  ingredients: string;
  allergens: string;
  recipe: RecipeLine[];
  name_es?: string;
  description_es?: string;
  image_url?: string;
  flavor_groups?: FlavorGroup[];
  pack_sizes?: PackSize[];
  display_order?: number;
  auto_generate_label?: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  reorderLevel: number;
  costPerUnit: number;
  supplier: string;
  ingredients_label?: string;
  allergens?: string[];
  unit_weight?: number;
  active?: boolean;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  createdAt: string;
  active?: boolean;
}

export interface OrderItem {
  productId: string;
  name: string;
  emoji: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string | null;
  customerName: string;
  phone: string;
  items: OrderItem[];
  source: OrderSource;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  subtotal: number;
  discount: number;
  total: number;
  dueDate: string;
  createdAt: string;
  notes: string;
  inventoryDeducted: boolean;
  foodColoring?: string | null;
}

export interface Payment {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  date: string;
  active?: boolean;
}

export type LabelShape = "rounded" | "circle" | "square" | "oval";

export type BusinessIdMode = "address" | "registration";

export interface LabelTemplate {
  id: string;
  name: string;
  shape: LabelShape;
  bgColor: string;
  accentColor: string;
  textColor: string;
  businessName: string;
  productName: string;
  details: string;
  ingredients: string;
  allergens: string;
  netWeight: string;
  price: string;
  showPrice: boolean;
  showBestBy: boolean;
  bestByDays: number;
  logoEmoji: string;
  logoImage?: string;
  logoSize?: number;
  font: string;
  businessIdMode: BusinessIdMode;
  address: string;
  phoneNumber: string;
  registrationNumber: string;
  showDisclaimer: boolean;
  labelWidth: number;
  labelHeight: number;
  active?: boolean;
}

export interface BusinessProfile {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  registrationNumber: string;
  acceptedMethods: Record<PaymentMethod, boolean>;
  cashtag: string;
  venmoHandle: string;
  applePayEnabled: boolean;
  stripeConnected: boolean;
}
