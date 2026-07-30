import { useMemo, useState } from "react";
import { ChevronDown, MessageSquareQuote } from "lucide-react";
import { useStore } from "../context/StoreContext";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import QuoteConvertModal from "../components/QuoteConvertModal";
import ProductIcon from "../components/ProductIcon";
import { formatCurrency, formatDate } from "../utils/format";
import type { Quote } from "../types";
import type { Page } from "../App";

export default function Quotes({ search, setPage }: { search: string; setPage: (p: Page) => void }) {
  const { quotes, handleUpdateQuote, loading } = useStore();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Quote | null>(null);
  const [quotedPrice, setQuotedPrice] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [archivedFrom, setArchivedFrom] = useState<Record<number, Quote["status"]>>({});

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

            {/* Order-level details */}
            <div className="rounded-xl border border-sand-100 bg-sand-50 p-4 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-cocoa-muted">Occasion</span>
                <span className="font-medium text-cocoa">{selected.occasion || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cocoa-muted">Desired date</span>
                <span className="font-medium text-cocoa">{selected.desiredDate || "—"}</span>
              </div>
              {selected.budget && (
                <div className="flex justify-between">
                  <span className="text-cocoa-muted">Budget</span>
                  <span className="font-medium text-cocoa">{selected.budget}</span>
                </div>
              )}
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

            {/* Items Section */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-cocoa-muted">
                {selected.items.length} {selected.items.length === 1 ? 'Item' : 'Items'}
              </h3>
              {selected.items.map((item, idx) => (
                <div key={item.id} className="rounded-xl bg-cream-deep/50 p-4 space-y-2">
                  <div className="flex items-center gap-2 mb-3">
                    <ProductIcon
                      type={item.product_type === 'cake' ? 'custom_cake' : item.product_type}
                      size={28}
                      imageUrl={item.reference_image_url}
                    />
                    <div>
                      <span className="font-semibold text-cocoa capitalize">
                        {item.product_type === 'cake' ? 'Custom Cake' : item.product_type === 'cakepops' ? 'Cakepops' : 'Cupcakes'}
                      </span>
                      {selected.items.length > 1 && (
                        <span className="ml-2 text-xs text-cocoa-muted">#{idx + 1}</span>
                      )}
                    </div>
                  </div>
                  {/* Render type-specific details */}
                  {Object.entries(item.details).map(([key, value]) => {
                    if (key === 'toppings' && Array.isArray(value)) {
                      return (
                        <div key={key}>
                          <p className="text-cocoa-muted">{key.replace(/_/g, ' ')}</p>
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
                        <div key={key} className="flex justify-between">
                          <span className="text-cocoa-muted">{key.replace(/_/g, ' ')}</span>
                          <span className="font-medium text-cocoa">{String(value)}</span>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              ))}
            </div>

            {/* Comments */}
            {selected.comments && (
              <div className="rounded-xl bg-coral-light/20 p-3 text-sm italic text-cocoa">
                "{selected.comments}"
              </div>
            )}

            {/* Reference image */}
            {selected.referenceImageUrl && (
              <div>
                <p className="mb-1 text-xs font-medium text-cocoa-muted">Reference image</p>
                <a href={selected.referenceImageUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    src={selected.referenceImageUrl}
                    alt="Reference"
                    className="max-h-48 rounded-xl border border-sand-200 object-contain"
                  />
                </a>
              </div>
            )}

            {/* Admin actions */}
            <div className="rounded-xl border border-sand-200 p-4 space-y-3">
              <p className="text-xs font-semibold uppercase text-cocoa-muted/60">Admin</p>

              <div>
                <label className="mb-1 block text-xs font-medium text-cocoa-muted">
                  Quoted price ($)
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

            <div className="flex items-center justify-between text-xs text-cocoa-muted">
              <span>Created {formatDate(selected.createdAt)}</span>
              <span>Updated {formatDate(selected.updatedAt)}</span>
            </div>
          </div>
        )}
      </Modal>

      {selected && (
        <QuoteConvertModal
          quote={selected}
          open={convertOpen}
          onClose={() => setConvertOpen(false)}
          onDone={(orderId) => {
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