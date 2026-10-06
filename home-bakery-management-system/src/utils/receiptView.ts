// Port of orders/workers/receipt-html.js for the client-rendered receipt
// document. Wording and palette must stay in sync with the server module;
// receiptView.test.ts pins the exact strings.

export interface ReceiptViewInput {
  receiptId: string;
  orderId: number;
  orderNumber?: string | null;
  customerName: string;
  itemsJson: string;
  totalCents: number;
  paymentMethod: string;
  paymentSubMethod?: string | null;
  orderStatus: string;
  language?: string | null;
  createdAt: string;
}

export interface ReceiptViewOrder {
  id: number;
  customer_name: string;
  items_json: string;
  total_cents: number;
  subtotal_cents?: number | null;
  discount_cents?: number | null;
  payment_method: string;
  payment_sub_method?: string | null;
  status: string;
  payment_status: string;
  pickup_date?: string | null;
  pickup_time?: string | null;
  created_at?: string;
  notes?: string | null;
  language?: string | null;
}

export interface ReceiptViewItem {
  name: string;
  qty: number;
  price: number;
}

export interface ReceiptViewModel {
  receiptId: string;
  orderId: number;
  orderNumber: string;
  customerName: string;
  email: string | null;
  createdAt: string;
  pickupDate: string | null;
  pickupTime: string | null;
  items: ReceiptViewItem[];
  rawItemsText: string | null;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentLabel: string;
  statusLabel: string;
  notes: string | null;
  paymentStatus: "paid" | "partial" | "unpaid";
  language: "en" | "es";
  labels: ReceiptViewLabels;
}

export interface ReceiptViewLabels {
  receipt: string;
  thanks: string;
  paidNote: string;
  date: string;
  payment: string;
  statusLabel: string;
  pickup: string;
  order: string;
  item: string;
  qty: string;
  amount: string;
  subtotal: string;
  discount: string;
  total: string;
  notes: string;
  contact: string;
  footer: string;
}

export function buildMethodLabel(method: string, subMethod: string | null | undefined, isEn: boolean): string {
  let label: string;
  if (method === "stripe") label = isEn ? "Card" : "Tarjeta";
  else if (method === "paypal") label = "PayPal";
  else if (method === "cashapp") label = "Cash App";
  else if (method === "venmo") label = "Venmo";
  else if (method === "applepay") label = "Apple Pay";
  else if (method === "cash") label = isEn ? "Cash" : "Efectivo";
  else label = method || "—";
  if (subMethod) {
    try {
      const parsed = JSON.parse(subMethod);
      if (method === "stripe" && parsed.type === "card" && parsed.brand) {
        const brand = parsed.brand.charAt(0).toUpperCase() + parsed.brand.slice(1).toLowerCase();
        const funding = parsed.funding
          ? " " + parsed.funding.charAt(0).toUpperCase() + parsed.funding.slice(1).toLowerCase()
          : "";
        const last4 = parsed.last4 ? " (…" + parsed.last4 + ")" : "";
        label = `${brand}${funding}${last4}`;
      } else if (method === "paypal" && parsed.type === "paypal_wallet") {
        label = "PayPal Wallet";
      }
    } catch {
      /* keep base label */
    }
  }
  return label;
}

export function formatStatusLabel(status: string, isEn: boolean): string {
  const map: Record<string, string> = isEn
    ? {
        pending: "Pending",
        "in-progress": "In Progress",
        ready: "Ready",
        completed: "Completed",
        cancelled: "Cancelled",
        awaiting_payment: "Awaiting Payment",
      }
    : {
        pending: "Pendiente",
        "in-progress": "En Progreso",
        ready: "Listo",
        completed: "Completado",
        cancelled: "Cancelado",
        awaiting_payment: "Esperando Pago",
      };
  return map[status] || status;
}

function emailMeta(paymentStatus: string, isEn: boolean) {
  const isPaid = paymentStatus === "paid";
  const isPartial = paymentStatus === "partial";
  return isEn
    ? {
        receipt: isPaid ? "RECEIPT" : "INVOICE",
        thanks: "Thank you for your order!",
        paidNote: isPaid
          ? "Your payment was received and your order is being prepared."
          : isPartial
            ? "Your order is confirmed. Deposit received — balance due at pickup."
            : "Your order is confirmed. Payment is due at pickup.",
        date: "Date",
        payment: "Payment",
        statusLabel: "Status",
        pickup: "Pickup",
        total: isPaid ? "TOTAL PAID" : isPartial ? "TOTAL" : "TOTAL DUE",
        contact: "Questions about your order? Reply to this email or call/text us at (616) 218-3582.",
        footer: "Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor",
      }
    : {
        receipt: isPaid ? "RECIBO" : "FACTURA",
        thanks: "¡Gracias por tu pedido!",
        paidNote: isPaid
          ? "Tu pago fue recibido y tu pedido se está preparando."
          : isPartial
            ? "Tu pedido está confirmado. Depósito recibido — el saldo se paga al recoger."
            : "Tu pedido está confirmado. El pago se realiza al recoger.",
        date: "Fecha",
        payment: "Pago",
        statusLabel: "Estado",
        pickup: "Recogida",
        total: isPaid ? "TOTAL PAGADO" : isPartial ? "TOTAL" : "TOTAL A PAGAR",
        contact: "¿Preguntas sobre tu pedido? Responde a este correo o llámanos al (616) 218-3582.",
        footer: "Muy Rico Bakery · Holland, Michigan · Familia · Tradición · Sabor",
      };
}

export function buildReceiptViewModel(
  receipt: ReceiptViewInput,
  order: ReceiptViewOrder | null,
  lang: "en" | "es",
): ReceiptViewModel {
  const isEn = lang === "en";
  const paymentStatus: "paid" | "partial" | "unpaid" = order
    ? order.payment_status === "paid"
      ? "paid"
      : order.payment_status === "partial"
        ? "partial"
        : "unpaid"
    : "paid"; // deleted-order snapshot predates invoice rendering — server keeps paid behavior
  const meta = emailMeta(paymentStatus, isEn);
  const labels: ReceiptViewLabels = {
    ...meta,
    order: isEn ? "Order" : "Pedido",
    item: isEn ? "Item" : "Producto",
    qty: isEn ? "Qty" : "Cant.",
    amount: isEn ? "Amount" : "Importe",
    subtotal: "Subtotal",
    discount: isEn ? "Discount" : "Descuento",
    notes: isEn ? "Notes" : "Notas",
  };

  const customerName = order?.customer_name ?? receipt.customerName;
  const itemsJson = order?.items_json ?? receipt.itemsJson;
  const totalCents = Number(order?.total_cents ?? receipt.totalCents) || 0;
  const discountCents = Number(order?.discount_cents ?? 0) || 0;
  const subtotalCents = Number(order?.subtotal_cents ?? 0) || totalCents + discountCents;
  const method = order?.payment_method ?? receipt.paymentMethod;
  const subMethod = order?.payment_sub_method ?? receipt.paymentSubMethod ?? null;
  const orderStatus = order?.status ?? receipt.orderStatus;
  const createdAt = order?.created_at ?? receipt.createdAt;

  let items: ReceiptViewItem[] = [];
  let rawItemsText: string | null = null;
  try {
    const parsed = JSON.parse(itemsJson);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    items = parsed.map((i: { name?: string; name_en?: string; name_es?: string; qty?: number; price?: number }) => ({
      name: (isEn ? i.name_en : i.name_es) || i.name || "",
      qty: Number(i.qty) || 0,
      price: Number(i.price) || 0,
    }));
  } catch {
    rawItemsText = itemsJson || null;
  }

  return {
    receiptId: receipt.receiptId,
    orderId: receipt.orderId,
    orderNumber: receipt.orderNumber || `MR-${receipt.orderId}`,
    customerName,
    email: null,
    createdAt,
    pickupDate: order?.pickup_date ?? null,
    pickupTime: order?.pickup_time ?? null,
    items,
    rawItemsText,
    subtotalCents,
    discountCents,
    totalCents,
    paymentLabel: buildMethodLabel(method, subMethod, isEn),
    statusLabel: orderStatus ? formatStatusLabel(orderStatus, isEn) : "—",
    notes: (order?.notes ?? "").trim() || null,
    paymentStatus,
    language: lang,
    labels,
  };
}
