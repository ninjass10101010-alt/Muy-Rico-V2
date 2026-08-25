import { useEffect, useState } from "react";
import { Trash2, X } from "lucide-react";
import Modal from "./ui/Modal";
import { useStore } from "../context/StoreContext";
import { uploadQuoteImage } from "../utils/api";
import QuoteItemComposer, { TYPE_LABELS, type DraftQuoteItem } from "./QuoteItemComposer";

const OCCASIONS = ["", "Birthday", "Wedding", "Anniversary", "Baby Shower", "Quinceañera", "Other"];
const DIETARY_OPTIONS = ["Gluten-Free", "Vegan", "Nut-Free", "Dairy-Free", "Egg-Free", "Sugar-Free"];

const inputCls = "w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm";

function summarize(item: DraftQuoteItem): string {
  const d = item.details;
  switch (item.product_type) {
    case "cake": {
      const parts = [d.cake_flavor, d.serving_size ? `${d.serving_size} servings` : ""].filter(Boolean);
      return parts.join(" · ");
    }
    case "cakepops":
      return [d.cake_flavor, d.chocolate_dip, d.topping_style, d.design_theme].filter(Boolean).join(" · ");
    case "cupcakes":
      return [d.cake_flavor, d.frosting].filter(Boolean).join(" · ");
    case "custom":
      return d.description || "";
    default:
      return "";
  }
}

export default function QuoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { customers, handleCreateQuote } = useStore();

  const [customerMode, setCustomerMode] = useState<"existing" | "new">("new");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [language, setLanguage] = useState<"es" | "en">("es");
  const [occasion, setOccasion] = useState("");
  const [desiredDate, setDesiredDate] = useState("");
  const [budget, setBudget] = useState("");
  const [comments, setComments] = useState("");
  const [dietary, setDietary] = useState<string[]>([]);
  const [refImageUrl, setRefImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const [items, setItems] = useState<DraftQuoteItem[]>([]);

  const [quotedPrice, setQuotedPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setCustomerMode("new");
    setCustomerId("");
    setCustomerName("");
    setPhone("");
    setEmail("");
    setLanguage("es");
    setOccasion("");
    setDesiredDate("");
    setBudget("");
    setComments("");
    setDietary([]);
    setRefImageUrl("");
    setItems([]);
    setQuotedPrice("");
    setErrorMsg("");
  }, [open]);

  function pickExisting(id: string) {
    setCustomerId(id);
    const c = customers.find((cc) => cc.id === id);
    if (c) {
      setCustomerName(c.name);
      setPhone(c.phone || "");
      setEmail(c.email || "");
    }
  }

  async function handleFile(file: File) {
    setUploading(true);
    setErrorMsg("");
    try {
      const res = await uploadQuoteImage(file);
      setRefImageUrl(res.url);
    } catch (err: any) {
      setErrorMsg(err.message || "Image upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (submitting) return;
    if (items.length === 0) {
      setErrorMsg("Add at least one item.");
      return;
    }
    if (!customerName.trim()) {
      setErrorMsg("Customer name is required.");
      return;
    }
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setErrorMsg("A valid email is required.");
      return;
    }

    setSubmitting(true);
    setErrorMsg("");

    try {
      let priceCents: number | null = null;
      if (quotedPrice.trim() !== "") {
        const parsed = parseFloat(quotedPrice);
        if (Number.isNaN(parsed) || parsed <= 0) {
          setErrorMsg("Quoted price must be a positive amount.");
          setSubmitting(false);
          return;
        }
        priceCents = Math.round(parsed * 100);
      }

      const payload = {
        customer_name: customerName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        language,
        occasion: occasion || null,
        dietary,
        comments: comments.trim() || null,
        desired_date: desiredDate || null,
        budget: budget.trim() || null,
        reference_image_url: refImageUrl || null,
        quoted_price: priceCents,
        items,
      };

      const newCustomer =
        customerMode === "new" && customerName.trim()
          ? {
              id: `cust_${Math.random().toString(36).slice(2, 9)}`,
              name: customerName.trim(),
              phone: phone.trim(),
              email: email.trim(),
            }
          : undefined;

      await handleCreateQuote(payload, newCustomer);
      onClose();
    } catch (err: any) {
      console.error("Failed to create quote:", err);
      setErrorMsg(err.message || "Failed to create quote. Check console or connection.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Quote" wide>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Quote language</label>
            <div className="flex gap-2">
              <button
                onClick={() => setLanguage("es")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${language === "es" ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted hover:border-sand-300"}`}
              >
                Español
              </button>
              <button
                onClick={() => setLanguage("en")}
                className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition ${language === "en" ? "border-palm bg-palm text-white" : "border-sand-200 text-cocoa-muted hover:border-sand-300"}`}
              >
                English
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Customer</label>
            <div className="mb-2 flex gap-2 text-xs">
              <button
                onClick={() => setCustomerMode("new")}
                className={`rounded-full px-3 py-1 ${customerMode === "new" ? "bg-coral-light/30 text-coral" : "bg-sand-100 text-cocoa-muted"}`}
              >
                New customer
              </button>
              <button
                onClick={() => setCustomerMode("existing")}
                className={`rounded-full px-3 py-1 ${customerMode === "existing" ? "bg-coral-light/30 text-coral" : "bg-sand-100 text-cocoa-muted"}`}
              >
                Existing customer
              </button>
            </div>
            {customerMode === "existing" ? (
              <select value={customerId} onChange={(e) => pickExisting(e.target.value)} className={inputCls}>
                <option value="">Select a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name *"
                  className={inputCls}
                />
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className={inputCls}
                />
              </div>
            )}
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email * (quote is sent here)"
              className={`${inputCls} mt-2`}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Occasion</label>
            <select value={occasion} onChange={(e) => setOccasion(e.target.value)} className={inputCls}>
              {OCCASIONS.map((o) => (
                <option key={o} value={o}>
                  {o || "Select…"}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 min-[480px]:grid-cols-2 gap-2">
            <div className="min-w-0">
              <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Desired date</label>
              <input type="date" value={desiredDate} onChange={(e) => setDesiredDate(e.target.value)} className={inputCls} />
            </div>
            <div className="min-w-0">
              <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Budget</label>
              <input value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="e.g. $60–80" className={inputCls} />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Dietary needs</label>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {DIETARY_OPTIONS.map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-xs text-cocoa-muted">
                  <input
                    type="checkbox"
                    checked={dietary.includes(d)}
                    onChange={(e) =>
                      setDietary((prev) => (e.target.checked ? [...prev, d] : prev.filter((x) => x !== d)))
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Comments</label>
            <textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              rows={2}
              placeholder="Special instructions, decorations..."
              className={inputCls}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Reference image</label>
            {refImageUrl ? (
              <div className="flex items-center gap-2 rounded-xl border border-sand-200 p-2">
                <img src={refImageUrl} alt="reference" className="h-12 w-12 rounded-lg object-cover" />
                <span className="min-w-0 flex-1 truncate text-xs text-cocoa-muted">{refImageUrl.split("/").pop()}</span>
                <button onClick={() => setRefImageUrl("")} className="rounded-md p-1 text-hibiscus hover:bg-hibiscus-light/10">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading}
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                className="w-full text-xs text-cocoa-muted"
              />
            )}
            {uploading && <p className="mt-1 text-[10px] text-cocoa-muted">Uploading…</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-cocoa-muted">Quoted price ($)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={quotedPrice}
              onChange={(e) => setQuotedPrice(e.target.value)}
              placeholder="Optional — leave empty to price later"
              className={inputCls}
            />
            <p className="mt-1 text-[10px] text-cocoa-muted">
              If set, the customer receives the itemized quote email immediately. If empty, the quote stays "new" until you price it.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-medium text-cocoa-muted">Items</label>
          <QuoteItemComposer
            key={items.length}
            submitLabel="+ Add item"
            onSubmit={(item: DraftQuoteItem) => setItems((prev) => [...prev, item])}
          />

          <div className="min-h-[120px] space-y-2 rounded-xl border border-dashed border-sand-200 p-3">
            {items.length === 0 && (
              <p className="py-6 text-center text-sm text-cocoa-muted">No items added yet.</p>
            )}
            {items.map((item, idx) => (
              <div key={idx} className="flex items-start justify-between gap-2 rounded-lg bg-sand-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-cocoa">
                    {TYPE_LABELS[item.product_type]}
                    {"details" in item && item.product_type === "custom"
                      ? ` — ${item.details.name}`
                      : ""}
                    {item.details.quantity ? <span className="text-cocoa-muted"> ×{item.details.quantity}</span> : null}
                  </p>
                  {summarize(item) && <p className="truncate text-xs text-cocoa-muted">{summarize(item)}</p>}
                </div>
                <button
                  onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                  className="ml-1 rounded-md p-1 text-hibiscus hover:bg-hibiscus-light/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          {errorMsg && (
            <div className="rounded-xl bg-hibiscus-light/10 p-3 text-sm text-hibiscus">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={items.length === 0 || submitting}
            className="w-full rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Creating..." : "Create Quote"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
