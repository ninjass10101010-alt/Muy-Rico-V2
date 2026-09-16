import { useEffect, useMemo, useState } from "react";
import Modal from "./ui/Modal";
import InvoiceItemComposer, { type DraftInvoiceItem } from "./InvoiceItemComposer";
import { useStore } from "../context/StoreContext";
import type { Invoice, PaymentOptions } from "../types";

const OPTIONS: { value: PaymentOptions; label: string; hint: string }[] = [
  { value: "full", label: "Full only", hint: "Customer pays the whole amount now" },
  { value: "deposit", label: "Deposit only", hint: "Customer pays 50% now, rest at pickup" },
  { value: "both", label: "Customer chooses", hint: "Shows both full and 50% options" },
];

export default function InvoiceModal({
  open,
  onClose,
  invoice,
}: {
  open: boolean;
  onClose: () => void;
  invoice?: Invoice | null;
}) {
  const { customers, handleCreateInvoice, handleUpdateInvoice } = useStore();
  const editing = !!invoice;

  const [customerName, setCustomerName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<"es" | "en">("es");
  const [dueDate, setDueDate] = useState("");
  const [paymentOptions, setPaymentOptions] = useState<PaymentOptions>("both");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftInvoiceItem[]>([{ description: "", qty: 1, unit_price_cents: 0 }]);
  const [sendNow, setSendNow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (invoice) {
      setCustomerName(invoice.customerName);
      setEmail(invoice.email);
      setPhone(invoice.phone || "");
      setLanguage(invoice.language);
      setDueDate(invoice.dueDate || "");
      setPaymentOptions(invoice.paymentOptions);
      setNotes(invoice.notes || "");
      setItems(invoice.items.map((i) => ({
        description: i.description, qty: i.qty, unit_price_cents: i.unit_price_cents,
      })));
    } else {
      setCustomerName(""); setEmail(""); setPhone(""); setLanguage("es");
      setDueDate(""); setPaymentOptions("both"); setNotes("");
      setItems([{ description: "", qty: 1, unit_price_cents: 0 }]);
      setSendNow(false);
    }
    setError("");
  }, [open, invoice]);

  const totalCents = useMemo(
    () => items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price_cents) || 0), 0),
    [items]
  );

  const matchCustomer = (name: string) => {
    const c = customers.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (c) {
      setEmail(c.email || email);
      setPhone(c.phone || phone);
    }
  };

  const submit = async () => {
    setError("");
    if (!customerName.trim() || !email.trim()) return setError("Customer name and email are required.");
    const clean = items.filter((i) => i.description.trim());
    if (clean.length === 0) return setError("Add at least one line item.");

    setSaving(true);
    try {
      if (editing && invoice) {
        await handleUpdateInvoice(invoice.id, {
          customer_name: customerName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          language,
          due_date: dueDate || null,
          payment_options: paymentOptions,
          notes: notes.trim() || null,
        });
      } else {
        await handleCreateInvoice({
          customer_name: customerName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          language,
          due_date: dueDate || null,
          payment_options: paymentOptions,
          notes: notes.trim() || null,
          items: clean,
          send: sendNow,
        });
      }
      onClose();
    } catch (e) {
      setError(String((e as Error).message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${invoice?.number}` : "New invoice"}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2">
            <span className="mb-1 block text-xs text-cocoa/70">Customer name *</span>
            <input
              className="w-full rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              onBlur={(e) => matchCustomer(e.target.value)}
              list="invoice-customers"
            />
            <datalist id="invoice-customers">
              {customers.map((c) => <option key={c.id} value={c.name} />)}
            </datalist>
          </label>
          <label>
            <span className="mb-1 block text-xs text-cocoa/70">Email *</span>
            <input
              type="email"
              className="w-full rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs text-cocoa/70">Phone</span>
            <input
              className="w-full rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label>
            <span className="mb-1 block text-xs text-cocoa/70">Language</span>
            <select
              className="w-full rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm"
              value={language}
              onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "es")}
            >
              <option value="es">Español</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-cocoa/70">Due date</span>
            <input
              type="date"
              className="w-full rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>

        <div>
          <span className="mb-1.5 block text-xs text-cocoa/70">Payment options</span>
          <div className="grid grid-cols-3 gap-2">
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setPaymentOptions(o.value)}
                className={`rounded-lg border px-3 py-2 text-left text-xs transition ${
                  paymentOptions === o.value
                    ? "border-coral bg-coral/5 text-cocoa"
                    : "border-sand-200 text-cocoa/60 hover:border-sand-300"
                }`}
                title={o.hint}
              >
                <span className="block font-medium">{o.label}</span>
                <span className="mt-0.5 block text-[10px] leading-tight text-cocoa/50">{o.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <InvoiceItemComposer items={items} onChange={setItems} />

        <label className="block">
          <span className="mb-1 block text-xs text-cocoa/70">Note to customer</span>
          <textarea
            className="w-full rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {!editing && (
          <label className="flex items-center gap-2 text-sm text-cocoa/80">
            <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
            Email the invoice to the customer now
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between border-t border-sand-200 pt-4">
          <span className="text-sm font-medium text-cocoa">Total: ${(totalCents / 100).toFixed(2)}</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-cocoa/70 transition hover:bg-sand-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="rounded-lg bg-palm px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Create invoice"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
