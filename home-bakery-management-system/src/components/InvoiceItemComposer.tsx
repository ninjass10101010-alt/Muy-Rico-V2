import { Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "../utils/format";

export interface DraftInvoiceItem {
  description: string;
  qty: number;
  unit_price_cents: number;
}

const emptyItem = (): DraftInvoiceItem => ({ description: "", qty: 1, unit_price_cents: 0 });

export default function InvoiceItemComposer({
  items,
  onChange,
}: {
  items: DraftInvoiceItem[];
  onChange: (items: DraftInvoiceItem[]) => void;
}) {
  const update = (i: number, patch: Partial<DraftInvoiceItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, emptyItem()]);

  const total = items.reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.unit_price_cents) || 0),
    0
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((it, i) => {
          const lineTotal = (Number(it.qty) || 0) * (Number(it.unit_price_cents) || 0);
          return (
            <div key={i} className="flex items-end gap-2">
              <label className="flex-1">
                <span className="mb-1 block text-xs text-cocoa/70">Description</span>
                <input
                  className="w-full rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm"
                  value={it.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                  placeholder="Tres leches 10&quot;"
                />
              </label>
              <label className="w-16">
                <span className="mb-1 block text-xs text-cocoa/70">Qty</span>
                <input
                  type="number"
                  min={1}
                  className="w-full rounded-lg border border-sand-200 bg-white px-2 py-2 text-sm"
                  value={it.qty}
                  onChange={(e) => update(i, { qty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                />
              </label>
              <label className="w-24">
                <span className="mb-1 block text-xs text-cocoa/70">Unit price</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full rounded-lg border border-sand-200 bg-white px-2 py-2 text-sm"
                  value={(it.unit_price_cents / 100).toString()}
                  onChange={(e) =>
                    update(i, { unit_price_cents: Math.round((parseFloat(e.target.value) || 0) * 100) })
                  }
                />
              </label>
              <div className="w-20 pb-2 text-right text-sm text-cocoa/70">{formatCurrency(lineTotal / 100)}</div>
              <button
                type="button"
                onClick={() => remove(i)}
                className="mb-1 rounded-lg p-2 text-cocoa/50 transition hover:bg-red-50 hover:text-red-600"
                aria-label="Remove item"
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 rounded-lg border border-dashed border-sand-300 px-3 py-2 text-sm text-cocoa/70 transition hover:border-coral hover:text-coral"
      >
        <Plus size={14} /> Add item
      </button>

      <div className="flex justify-end border-t border-sand-200 pt-3 text-sm font-medium text-cocoa">
        Total: {formatCurrency(total / 100)}
      </div>
    </div>
  );
}
