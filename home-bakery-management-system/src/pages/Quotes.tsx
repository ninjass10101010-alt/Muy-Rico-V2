import { useMemo, useState } from "react";
import { ChevronDown, Plus, Printer } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import QuoteConvertModal from "../components/QuoteConvertModal";
import QuoteModal from "../components/QuoteModal";
import ProductIcon from "../components/ProductIcon";
import { quoteHtmlUrl } from "../utils/api";
import { formatCurrency, formatDate } from "../utils/format";
import type { Quote } from "../types";
import type { Page } from "../App";

const ITEM_DETAIL_LABELS: Record<string, Record<string, string>> = {
  cake: {
    cake_flavor: "Cake flavor",
    filling: "Filling",
    frosting: "Frosting",
    serving_size: "Serving size",
    toppings: "Toppings",
  },
  cakepops: {
    cake_flavor: "Cake flavor",
    chocolate_dip: "Chocolate dip",
    topping_style: "Topping style",
    quantity: "Quantity",
    design_theme: "Design theme",
  },
  cupcakes: {
    cake_flavor: "Cake flavor",
    frosting: "Frosting",
    quantity: "Quantity",
  },
  custom: {
    name: "Name",
    description: "Description",
    quantity: "Quantity",
  },
};

const ITEM_EMOJI: Record<string, string> = {
  cake: "🎂",
  cakepops: "🍭",
  cupcakes: "🧁",
  custom: "✨",
};

function itemCardTitle(item: Quote["items"][number]): string {
  const d = item.details || {};
  switch (item.product_type) {
    case "cake":
      return d.cake_flavor ? `Custom Cake — ${d.cake_flavor}` : "Custom Cake";
    case "cakepops":
      return `Cakepops ×${Number(d.quantity) || 6}`;
    case "cupcakes":
      return `Cupcakes ×${Number(d.quantity) || 6}`;
    case "custom": {
      const qty = Number(d.quantity) || 1;
      const base = String(d.name || "Custom item");
      return qty > 1 ? `${base} ×${qty}` : base;
    }
    default:
      return item.product_type;
  }
}

export default function Quotes({ search, setPage }: { search: string; setPage: (p: Page) => void }) {
  const { quotes, orders, customers, handleUpdateQuote, handleDeleteQuote, loading } = useStore();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Quote | null>(null);
  const [quotedPrice, setQuotedPrice] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [archivedFrom, setArchivedFrom] = useState<Record<number, Quote["status"]>>({});
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return quotes
      .filter((q) => (statusFilter === "all" ? true : q.status === statusFilter))
      .filter((q) =>
        search
          ? q.customerName.toLowerCase().includes(search.toLowerCase()) ||
            q.email.toLowerCase().includes(search.toLowerCase())
          : true,
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [quotes, statusFilter, search]);

  function openDetail(q: Quote) {
    setSelected(q);
    setQuotedPrice(q.quotedPrice ? (q.quotedPrice / 100).toFixed(2) : "");
    setAdminNotes(q.adminNotes || "");
    setSaveMsg(null);
  }

  async function saveQuote() {
    if (!selected) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const priceCents = quotedPrice ? Math.round(parseFloat(quotedPrice) * 100) : null;
      await handleUpdateQuote(selected.id, {
        quoted_price: priceCents,
        admin_notes: adminNotes || null,
      });
      setSaveMsg("Quote saved. Customer will receive email with price.");
    } catch (err) {
      setSaveMsg("Failed to save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function archiveQuote() {
    if (!selected) return;
    const prev = selected.status;
    try {
      setArchivedFrom((m) => ({ ...m, [selected.id]: prev }));
      await handleUpdateQuote(selected.id, { status: "archived" });
      setSelected(null);
    } catch (err) {
      setSaveMsg("Failed to archive. Try again.");
    }
  }

  async function deleteQuote() {
    if (!selected) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await handleDeleteQuote(selected.id);
      setConfirmDeleteOpen(false);
      setSelected(null);
    } catch (err) {
      setDeleteError("Failed to delete. Try again.");
      setDeleting(false);
    }
  }

  const history = useMemo(() => {
    if (!selected || !selected.email) return null;
    const email = selected.email.toLowerCase();
    const customer = customers.find((c) => (c.email || "").toLowerCase() === email);
    const pastOrders = customer
      ? orders.filter((o) => o.customerId === customer.id).length
      : 0;
    const otherQuotes = quotes.filter(
      (q) => q.id !== selected.id && q.email.toLowerCase() === email,
    ).length;
    return { pastOrders, otherQuotes };
  }, [selected, customers, orders, quotes]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={statusFilter}
          onChange={setStatusFilter}
          options={["all", "new", "replied", "converted", "archived"]}
          label="Status"
        />
        <span className="ml-auto text-sm text-cocoa-muted">{filtered.length} quotes</span>
        <button onClick={() => setCreateOpen(true)} className="btn-primary">
          <Plus size={14} className="mr-1 inline" />
          New Quote
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-sand-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50 text-left text-xs uppercase tracking-wide text-cocoa-muted">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Occasion</th>
                <th className="px-4 py-3">Flavor</th>
                <th className="px-4 py-3">Wants by</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Quoted</th>
                <th className="px-4 py-3">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {filtered.map((q) => (
                <tr key={q.id} className="cursor-pointer hover:bg-sand-50" onClick={() => openDetail(q)}>
                  <td className="px-4 py-3 font-medium text-cocoa">{q.customerName}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{q.occasion || "—"}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{q.cakeFlavor}</td>
                  <td className="px-4 py-3 text-cocoa-muted">{q.desiredDate || "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={q.status}>{q.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-cocoa">
                    {q.quotedPrice != null ? formatCurrency(q.quotedPrice / 100) : "—"}
                  </td>
                  <td className="px-4 py-3 text-cocoa-muted">{formatDate(q.createdAt)}</td>
                </tr>
              ))}
              {loading && quotes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-palm border-t-transparent" />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-cocoa-muted">
                    No quotes match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Quote #${selected.id}` : ""} wide>
        {selected && (
          <div className="space-y-5">
            {/* Customer info */}
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-cocoa">
                  {selected.customerName}
                  <span className="ml-2 inline-block rounded-full bg-sand-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cocoa-muted">
                    {selected.language}
                  </span>
                </p>
                <p className="text-xs text-cocoa-muted">{selected.email}</p>
                {selected.phone && <p className="text-xs text-cocoa-muted">{selected.phone}</p>}
              </div>
              <Badge tone={selected.status}>{selected.status}</Badge>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              {/* Column A — what the customer asked for */}
              <div className="space-y-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-cocoa-muted/60">
                  Customer request
                </h3>

                {/* Visuals zone */}
                {(selected.referenceImageUrl || (selected.inspiration && selected.inspiration.length > 0)) && (
                  <div className="space-y-3">
                    {selected.referenceImageUrl && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-cocoa-muted">Reference photo</p>
                        <a href={selected.referenceImageUrl} target="_blank" rel="noopener noreferrer">
                          <img
                            src={selected.referenceImageUrl}
                            alt="Customer reference"
                            className="max-h-64 w-full rounded-xl border border-sand-200 object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        </a>
                      </div>
                    )}
                    {selected.inspiration && selected.inspiration.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-medium text-cocoa-muted">Inspiration they picked</p>
                        <div className="flex flex-wrap gap-2">
                          {selected.inspiration.map((insp, idx) => (
                            <a
                              key={idx}
                              href={insp.image_url || undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 rounded-xl bg-cream-deep/50 p-2"
                            >
                              {insp.image_url && (
                                <img
                                  src={insp.image_url}
                                  alt={insp.title || "Inspiration"}
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                  className="h-16 w-16 rounded-lg border border-sand-200 object-cover"
                                />
                              )}
                              <span className="text-sm font-medium text-cocoa">{insp.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

            {/* Items Section */}
            <div className="space-y-3">
              {selected.items.length > 0 && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-cocoa-muted">
                  {selected.items.length} {selected.items.length === 1 ? "Item" : "Items"}
                </h3>
              )}
              {selected.items.length === 0 && (
                <div className="rounded-xl bg-cream-deep/50 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <ProductIcon emoji="🎂" size={28} imageUrl={null} />
                    <span className="font-semibold text-cocoa">
                      {selected.cakeFlavor ? `Custom Cake — ${selected.cakeFlavor}` : "Custom Cake"}
                    </span>
                  </div>
                  {selected.filling && (
                    <div className="flex justify-between gap-4">
                      <span className="text-cocoa-muted text-xs">Filling</span>
                      <span className="font-medium text-cocoa text-sm text-right">{selected.filling}</span>
                    </div>
                  )}
                  {selected.frosting && (
                    <div className="flex justify-between gap-4">
                      <span className="text-cocoa-muted text-xs">Frosting</span>
                      <span className="font-medium text-cocoa text-sm text-right">{selected.frosting}</span>
                    </div>
                  )}
                  {selected.servingSize && (
                    <div className="flex justify-between gap-4">
                      <span className="text-cocoa-muted text-xs">Serving size</span>
                      <span className="font-medium text-cocoa text-sm text-right">{selected.servingSize}</span>
                    </div>
                  )}
                  {selected.toppings.length > 0 && (
                    <div>
                      <p className="text-cocoa-muted text-xs">Toppings</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {selected.toppings.map((t) => (
                          <span key={t} className="rounded-full bg-coral-light/20 px-2 py-0.5 text-xs font-medium text-coral ring-1 ring-coral-light">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {selected.items.map((item, idx) => {
                const labels = ITEM_DETAIL_LABELS[item.product_type] || {};
                const skipDetail = (key: string) =>
                  (item.product_type === "custom" && key === "name") ||
                  ((item.product_type === "cakepops" || item.product_type === "cupcakes" || item.product_type === "custom") && key === "quantity");
                return (
                  <div key={item.id} className="rounded-xl bg-cream-deep/50 p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <ProductIcon
                        emoji={ITEM_EMOJI[item.product_type] || "🍞"}
                        size={28}
                        imageUrl={item.reference_image_url}
                      />
                      <span className="font-semibold text-cocoa">{itemCardTitle(item)}</span>
                      {selected.items.length > 1 && (
                        <span className="text-xs text-cocoa-muted">#{idx + 1}</span>
                      )}
                    </div>
                    {Object.entries(item.details).map(([key, value]) => {
                      if (skipDetail(key)) return null;
                      const label = labels[key] || key.replace(/_/g, " ");
                      if (key === "toppings" && Array.isArray(value) && value.length > 0) {
                        return (
                          <div key={key}>
                            <p className="text-cocoa-muted text-xs">{label}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {value.map((t: string) => (
                                <span key={t} className="rounded-full bg-coral-light/20 px-2 py-0.5 text-xs font-medium text-coral ring-1 ring-coral-light">
                                  {t}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      if (value && String(value).trim()) {
                        return (
                          <div key={key} className="flex justify-between gap-4">
                            <span className="text-cocoa-muted text-xs">{label}</span>
                            <span className="font-medium text-cocoa text-sm text-right">
                              {Array.isArray(value) ? value.join(", ") : String(value)}
                            </span>
                          </div>
                        );
                      }
                      return null;
                    })}
                    {item.reference_image_url && (
                      <a
                        href={item.reference_image_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-palm hover:underline"
                      >
                        📷 View photo
                      </a>
                    )}
                  </div>
                );
              })}
            </div>

                {/* Comments */}
                {selected.comments && (
                  <div className="rounded-xl bg-coral-light/20 p-3 text-sm italic text-cocoa">
                    "{selected.comments}"
                  </div>
                )}

                {/* Meta facts (budget lives next to the price input now) */}
                <div className="rounded-xl border border-sand-100 bg-sand-50 p-4 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-cocoa-muted">Occasion</span>
                    <span className="font-medium text-cocoa">{selected.occasion || "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-cocoa-muted">Desired date</span>
                    <span className="font-medium text-cocoa">{selected.desiredDate || "—"}</span>
                  </div>
                  {selected.dietary.length > 0 && (
                    <div>
                      <p className="text-cocoa-muted">Dietary</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {selected.dietary.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-mid-green-light/20 px-2 py-0.5 text-xs font-medium text-palm ring-1 ring-mid-green-light"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Column B — pricing & admin */}
              <div className="space-y-5">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-cocoa-muted/60">
                  Pricing &amp; admin
                </h3>

            {/* Admin actions */}
            <div className="rounded-xl border border-sand-200 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase text-cocoa-muted/60">Admin</p>

              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-cocoa-muted">Quote document</span>
                <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-sand-200 overflow-hidden">
                  <button
                    onClick={() => window.open(quoteHtmlUrl(selected.id, 'en'))}
                    className="px-2 py-1 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 border-r border-sand-200"
                  >EN</button>
                  <button
                    onClick={() => window.open(quoteHtmlUrl(selected.id, 'es'))}
                    className="px-2 py-1 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50 border-r border-sand-200"
                  >ES</button>
                  <button
                    onClick={() => window.open(quoteHtmlUrl(selected.id))}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-cocoa-muted transition hover:bg-sand-50"
                  >
                    <Printer size={12} />
                    Print
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-cocoa-muted">Budget customer shared</p>
                <p className={`mb-2 mt-0.5 text-sm font-semibold ${selected.budget ? "text-cocoa" : "text-cocoa-muted/60"}`}>
                  {selected.budget || "Not shared"}
                </p>
                <label className="mb-1 block text-xs font-medium text-cocoa-muted">
                  Your quoted price ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={quotedPrice}
                  onChange={(e) => setQuotedPrice(e.target.value)}
                  placeholder="0.00"
                  className="input"
                  disabled={selected.status === "converted" || selected.status === "archived"}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-cocoa-muted">
                  Admin notes
                </label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={2}
                  placeholder="Notes about this quote..."
                  className="input"
                  disabled={selected.status === "converted" || selected.status === "archived"}
                />
              </div>

              {selected.status !== "archived" && selected.status !== "converted" && (
                <div className="flex gap-2">
                  <button onClick={saveQuote} disabled={saving} className="btn-primary flex-1">
                    {saving ? "Saving..." : "Save & Email Quote"}
                  </button>
                  <button
                    onClick={() => setConvertOpen(true)}
                    disabled={selected.quotedPrice == null}
                    className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                    title={selected.quotedPrice == null ? "Save a quoted price first" : undefined}
                  >
                    Convert to Order
                  </button>
                </div>
              )}

              {selected.status === "converted" && selected.convertedOrderId && (
                <button
                  onClick={() => setPage("orders")}
                  className="btn-secondary w-full"
                >
                  View Order #{selected.convertedOrderId} →
                </button>
              )}

              {saveMsg && (
                <p className={`text-xs ${saveMsg.includes("Failed") ? "text-hibiscus" : "text-mid-green"}`}>
                  {saveMsg}
                </p>
              )}

              {selected.status !== "converted" && selected.status !== "archived" && (
                <button
                  onClick={async () => {
                    if (!window.confirm("Archive this quote? You can unarchive it later.")) return;
                    await archiveQuote();
                  }}
                  className="text-xs text-cocoa-muted hover:text-hibiscus"
                >
                  Archive quote
                </button>
              )}

              <button
                onClick={() => {
                  setDeleteError(null);
                  setDeleting(false);
                  setConfirmDeleteOpen(true);
                }}
                className="text-xs font-medium text-hibiscus hover:underline"
              >
                Delete quote
              </button>

              {selected.status === "archived" && (
                <button
                  onClick={async () => {
                    const restoreTo = archivedFrom[selected.id] || "new";
                    await handleUpdateQuote(selected.id, { status: restoreTo });
                    setSelected(null);
                  }}
                  className="text-xs text-coral hover:underline"
                >
                  Unarchive
                </button>
              )}
                </div>
              </div>
            </div>

            {/* Customer history */}
            <div className="rounded-xl border border-sand-100 bg-sand-50 px-4 py-3 text-xs text-cocoa-muted">
              <span className="font-semibold text-cocoa">{selected.customerName}</span>
              {" · "}{selected.email}
              {selected.phone && <>{" · "}{selected.phone}</>}
              {history && (
                <span className="text-cocoa-muted/80">
                  {" — "}
                  {history.pastOrders} past {history.pastOrders === 1 ? "order" : "orders"}
                  {" · "}
                  {history.otherQuotes} other {history.otherQuotes === 1 ? "quote" : "quotes"}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-cocoa-muted">
              <span>Created {formatDate(selected.createdAt)}</span>
              <span>Updated {formatDate(selected.updatedAt)}</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        title={selected?.convertedOrderId ? "Delete converted quote?" : "Delete this quote?"}
      >
        {selected && (
          <div className="space-y-4">
            <p className="text-sm text-cocoa">
              This permanently removes quote #{selected.id} and all its items.{" "}
              <span className="font-semibold">This cannot be undone.</span>
            </p>
            {selected.convertedOrderId && (
              <p className="rounded-xl bg-coral-light/20 p-3 text-sm text-cocoa">
                Order #{selected.convertedOrderId} stays, but the link from this quote will be lost.
              </p>
            )}
            {deleteError && <p className="text-xs text-hibiscus">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteOpen(false)} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={deleteQuote}
                disabled={deleting}
                className="rounded-xl bg-hibiscus px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete permanently"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <QuoteModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {selected && (
        <QuoteConvertModal
          quote={selected}
          open={convertOpen}
          onClose={() => setConvertOpen(false)}
          onDone={() => {
            setConvertOpen(false);
            setSelected(null);
            setPage("orders");
          }}
        />
      )}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl border border-sand-200 bg-white py-2 pl-3 pr-8 text-sm capitalize text-cocoa-muted outline-none focus:border-palm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "all" ? `All ${label}` : o}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-cocoa-muted" />
    </div>
  );
}