export type PaymentMethod = "stripe" | "paypal" | "cashapp" | "venmo" | "applepay" | "cash";

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
  show_online?: boolean;
  flavor_deduction_map?: Record<string, Record<string, string[]>> | null;
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
  barcode?: string | null;
  groupId?: string | null;
  nutritionSource?: string;
  nutritionFetchedAt?: string;
}

export interface IngredientGroup {
  id: string;
  name: string;
  category: string | null;
  activeItemId: string | null;
  active: boolean;
  members: InventoryItem[];
  usedBy: string[];
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
  paymentSubMethod?: string | null;
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
  methodDetails?: string | null;
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

  calories: number;
  fat: number;
  fatDaily: number;
  satFat: number;
  satFatDaily: number;
  transFat: number;
  cholesterol: number;
  cholesterolDaily: number;
  sodium: number;
  sodiumDaily: number;
  carbs: number;
  carbsDaily: number;
  fiber: number;
  fiberDaily: number;
  sugar: number;
  protein: number;
  vitaminD: number;
  vitaminDDaily: number;
  calcium: number;
  calciumDaily: number;
  iron: number;
  ironDaily: number;
  potassium: number;
  potassiumDaily: number;
}

export interface LabelElement {
  id: string;
  type: LabelElementType;
  field?: LabelElementField;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  hidden?: boolean;
  lock?: boolean;
  fontSize?: number;
  fontWeight?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  opacity?: number;
  align?: "left" | "center" | "right";
  text?: string;
  rotation?: number;
  qrValue?: string;
  qrErrorLevel?: "L" | "M" | "Q" | "H";
  radius?: number;
  nfpData?: NfpData;
  nfp_title?: string;
  nfp_show_title?: boolean;
  nfp_subtitle?: string;
  nfp_show_subtitle?: boolean;
  nfp_show_footer?: boolean;
  nfp_layout?: "standard" | "vertical";
  fontSizeOverride?: number;
  colorOverride?: string;
  fontFamilyOverride?: string;
  alignOverride?: "left" | "center" | "right";
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
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
  bestByDate?: string | null;
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
  displayOrder?: number;
  elements: LabelElement[];
  websiteUrl: string;
  orientation: LabelOrientation;
  disclaimerVariant: DisclaimerVariant;
  productType: ProductType;
  allergenTags: string[];
  noAllergensConfirmed: boolean;
  nutrientClaim: boolean;
  bgImage?: string;
  averyPreset: AveryPreset;
  active?: boolean;
  templateKind?: "product" | "order" | "custom";
  productId?: string | null;
}

export interface QuoteItem {
  id: number;
  product_type: 'cake' | 'cakepops' | 'cupcakes';
  details: Record<string, any>;
  reference_image_url?: string | null;
}

export interface Quote {
  id: number;
  status: "new" | "replied" | "converted" | "archived";
  customerName: string;
  email: string;
  phone: string | null;
  language: "es" | "en";
  occasion: string | null;
  servingSize: string | null;
  cakeFlavor: string;
  filling: string | null;
  frosting: string | null;
  toppings: string[];
  dietary: string[];
  referenceImageUrl: string | null;
  comments: string | null;
  desiredDate: string | null;
  budget: string | null;
  quotedPrice: number | null;
  adminNotes: string | null;
  convertedOrderId: number | null;
  items: QuoteItem[];
  inspiration?: { product_id?: string; title?: string; image_url?: string }[];
  createdAt: string;
  updatedAt: string;
}
// ─── Reminders / calendar config ─────────────────────────────────────────────

export interface ReminderConfig {
  leadDays: number;
  dayOf: boolean;
  defaultSnoozeHours: number;
  dayStartTime: number;
  dayEndTime: number;
}

export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  leadDays: 2,
  dayOf: true,
  defaultSnoozeHours: 24,
  dayStartTime: 9,
  dayEndTime: 19,
};

export interface BusinessProfile {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  registrationNumber: string;
  businessType: "cottage" | "licensed";
  acceptedMethods: Record<PaymentMethod, boolean>;
  cashtag: string;
  venmoHandle: string;
  applePayEnabled: boolean;
  stripeConnected: boolean;
  reminders: ReminderConfig;
}
