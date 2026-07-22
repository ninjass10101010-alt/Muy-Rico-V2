export type PaymentMethod = "stripe" | "cashapp" | "venmo" | "applepay" | "cash";

export type OrderSource = "website" | "in-person";

export type OrderStatus = "pending" | "in-progress" | "ready" | "completed" | "cancelled" | "awaiting_payment";

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
  featured?: boolean;
}

export interface GalleryPhoto {
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
  flavorNote?: string;
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

export type LabelOrientation = "portrait" | "landscape";

export type LabelElementType = "text" | "logo" | "qr" | "divider" | "rect" | "circle" | "line" | "nfp";

export type LabelElementField =
  | "logo"
  | "businessName"
  | "businessId"
  | "productName"
  | "details"
  | "ingredients"
  | "allergens"
  | "netWeight"
  | "price"
  | "bestBy"
  | "disclaimer"
  | "qr"
  | "divider"
  | "shape"
  | "nfp";

export type DisclaimerVariant = "standard";
export type ProductType = "standard" | "wedding";
export type BusinessType = "cottage" | "licensed";
export type AveryPreset = "single" | "5164" | "5163" | "8163";

export interface NfpData {
  servingSize: string;
  servings: string;
  calories: string;
  totalFat: string;
  satFat: string;
  transFat: string;
  cholesterol: string;
  sodium: string;
  totalCarb: string;
  fiber: string;
  sugars: string;
  addedSugars: string;
  protein: string;
  vitD: string;
  calcium: string;
  iron: string;
  potassium: string;
  vitA: string;
  vitC: string;
}

export interface LabelElement {
  id: string;
  type: LabelElementType;
  field: LabelElementField;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rotation: number;
  hidden: boolean;
  lock?: boolean;
  fontSizeOverride?: number;
  fontFamilyOverride?: string;
  colorOverride?: string;
  alignOverride?: "left" | "center" | "right";
  opacity?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  qrErrorLevel?: "L" | "M" | "Q" | "H";
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
  nfpData?: NfpData;
}

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
  netWeightUS: string;
  netWeightMetric: string;
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
  orientation: LabelOrientation;
  websiteUrl: string;
  elements: LabelElement[];
  disclaimerVariant: DisclaimerVariant;
  productType: ProductType;
  allergenTags: string[];
  noAllergensConfirmed: boolean;
  nutrientClaim: boolean;
  bgImage?: string;
  averyPreset: AveryPreset;
  active?: boolean;
}

export interface BusinessProfile {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  registrationNumber: string;
  businessType: BusinessType;
  acceptedMethods: Record<PaymentMethod, boolean>;
  cashtag: string;
  venmoHandle: string;
  applePayEnabled: boolean;
  stripeConnected: boolean;
}

export interface ComplianceIssue {
  id: string;
  requirement: string;
  severity: "error" | "warning";
  fieldName: string;
  current: string;
  fix?: string;
  elementId?: string;
}

export interface ComplianceResult {
  score: number;
  issues: ComplianceIssue[];
  isCompliant: boolean;
}
