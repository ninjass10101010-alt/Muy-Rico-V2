import { useState } from "react";

export type QuoteItemType = "cake" | "cakepops" | "cupcakes" | "custom";

export interface DraftQuoteItem {
  product_type: QuoteItemType;
  details: Record<string, any>;
}

export const TYPE_LABELS: Record<QuoteItemType, string> = {
  cake: "Cake",
  cakepops: "Cakepops",
  cupcakes: "Cupcakes",
  custom: "Custom item",
};

const CAKE_TOPPINGS = ["Sprinkles", "Fresh Fruit", "Chocolate Ganache", "Caramel Drip", "Edible Flowers", "Fondant Decorations"];
const POP_FLAVORS = ["Chocolate", "Vanilla", "Strawberry"];
const DIPS = ["Milk Chocolate", "White Chocolate"];
const TOPPING_STYLES = ["Marble", "Sprinkles", "Chocolate Drizzle", "Chocolate Accessories", "Fondant Accessories"];
const FROSTING_OPTIONS = ["Vanilla Frosting", "Chocolate Frosting"];

const inputCls = "w-full rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm";

interface QuoteItemComposerProps {
  initial?: DraftQuoteItem;
  submitLabel: string;
  onSubmit: (item: DraftQuoteItem) => void;
  onCancel?: () => void;
  submitting?: boolean;
}

export default function QuoteItemComposer({ initial, submitLabel, onSubmit, onCancel, submitting }: QuoteItemComposerProps) {
  const lockedType = initial?.product_type;
  const [itemType, setItemType] = useState<QuoteItemType>(lockedType ?? "cake");

  const [cakeFlavorText, setCakeFlavorText] = useState(String(initial?.details?.cake_flavor ?? ""));
  const [filling, setFilling] = useState(String(initial?.details?.filling ?? ""));
  const [frostingText, setFrostingText] = useState(String(initial?.details?.frosting ?? ""));
  const [servingSize, setServingSize] = useState(String(initial?.details?.serving_size ?? ""));
  const [cakeToppings, setCakeToppings] = useState<string[]>(Array.isArray(initial?.details?.toppings) ? initial.details.toppings : []);
  const [popFlavor, setPopFlavor] = useState(String(initial?.details?.cake_flavor ?? ""));
  const [chocolateDip, setChocolateDip] = useState(String(initial?.details?.chocolate_dip ?? ""));
  const [toppingStyle, setToppingStyle] = useState(String(initial?.details?.topping_style ?? ""));
  const popQtyInit = initial?.product_type === "cakepops" ? String(Number(initial.details?.quantity) || "") : "";
  const [popQtyPick, setPopQtyPick] = useState(["6", "12", "24"].includes(popQtyInit) ? popQtyInit : popQtyInit ? "custom" : "");
  const [popQtyCustom, setPopQtyCustom] = useState(popQtyInit && !["6", "12", "24"].includes(popQtyInit) ? popQtyInit : "");
  const [popTheme, setPopTheme] = useState(String(initial?.details?.design_theme ?? ""));
  const [cupFlavor, setCupFlavor] = useState(String(initial?.details?.cake_flavor ?? ""));
  const [cupFrosting, setCupFrosting] = useState(String(initial?.details?.frosting ?? ""));
  const cupQtyInit = initial?.product_type === "cupcakes" ? String(Number(initial.details?.quantity) || "") : "";
  const [cupQtyPick, setCupQtyPick] = useState(["6", "12", "24"].includes(cupQtyInit) ? cupQtyInit : cupQtyInit ? "custom" : "");
  const [cupQtyCustom, setCupQtyCustom] = useState(cupQtyInit && !["6", "12", "24"].includes(cupQtyInit) ? cupQtyInit : "");
  const [customName, setCustomName] = useState(String(initial?.details?.name ?? ""));
  const [customDesc, setCustomDesc] = useState(String(initial?.details?.description ?? ""));
  const [customQty, setCustomQty] = useState(initial?.product_type === "custom" ? String(Number(initial.details?.quantity) || 1) : "1");

  const popQty = popQtyPick === "custom" ? Number(popQtyCustom) : Number(popQtyPick);
  const cupQty = cupQtyPick === "custom" ? Number(cupQtyCustom) : Number(cupQtyPick);

  const composeValid =
    itemType === "cake"
      ? cakeFlavorText.trim().length > 0
      : itemType === "cakepops"
        ? popFlavor !== "" && chocolateDip !== "" && toppingStyle !== "" && popQty > 0
        : itemType === "cupcakes"
          ? cupFlavor !== "" && cupFrosting !== "" && cupQty > 0
          : customName.trim().length > 0;

  function buildDetails(): Record<string, any> | null {
    if (itemType === "cake") {
      if (!composeValid) return null;
      return {
        cake_flavor: cakeFlavorText.trim(),
        ...(filling.trim() ? { filling: filling.trim() } : {}),
        ...(frostingText.trim() ? { frosting: frostingText.trim() } : {}),
        ...(servingSize ? { serving_size: servingSize } : {}),
        ...(cakeToppings.length ? { toppings: cakeToppings } : {}),
      };
    }
    if (itemType === "cakepops") {
      if (!composeValid) return null;
      return {
        cake_flavor: popFlavor,
        chocolate_dip: chocolateDip,
        topping_style: toppingStyle,
        quantity: popQty,
        ...(popTheme.trim() ? { design_theme: popTheme.trim() } : {}),
      };
    }
    if (itemType === "cupcakes") {
      if (!composeValid) return null;
      return { cake_flavor: cupFlavor, frosting: cupFrosting, quantity: cupQty };
    }
    if (!composeValid) return null;
    return {
      name: customName.trim(),
      ...(customDesc.trim() ? { description: customDesc.trim() } : {}),
      quantity: Number(customQty) > 0 ? Number(customQty) : 1,
    };
  }

  function handleSubmit() {
    const details = buildDetails();
    if (!details) return;
    onSubmit({ product_type: itemType, details });
  }

  const showQtyCustom = itemType === "cakepops" ? popQtyPick === "custom" : cupQtyPick === "custom";

  return (
    <div className="space-y-2">
      {!lockedType && (
        <div className="flex gap-2">
          <select
            value={itemType}
            onChange={(e) => setItemType(e.target.value as QuoteItemType)}
            className="flex-1 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
          >
            {(Object.keys(TYPE_LABELS) as QuoteItemType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      )}

      {itemType === "cake" && (
        <>
          <input value={cakeFlavorText} onChange={(e) => setCakeFlavorText(e.target.value)} placeholder="Cake flavor *" className={inputCls} />
          <input value={filling} onChange={(e) => setFilling(e.target.value)} placeholder="Filling" className={inputCls} />
          <input value={frostingText} onChange={(e) => setFrostingText(e.target.value)} placeholder="Frosting" className={inputCls} />
          <select value={servingSize} onChange={(e) => setServingSize(e.target.value)} className={inputCls}>
            <option value="">Serving size…</option>
            {["6-8", "10-12", "15-20", "20-30", "30+"].map((s) => (
              <option key={s} value={s}>{s} servings</option>
            ))}
          </select>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 pt-1">
            {CAKE_TOPPINGS.map((t) => (
              <label key={t} className="flex items-center gap-1.5 text-xs text-cocoa-muted">
                <input
                  type="checkbox"
                  checked={cakeToppings.includes(t)}
                  onChange={(e) =>
                    setCakeToppings((prev) => (e.target.checked ? [...prev, t] : prev.filter((x) => x !== t)))
                  }
                />
                {t}
              </label>
            ))}
          </div>
        </>
      )}

      {itemType === "cakepops" && (
        <>
          <select value={popFlavor} onChange={(e) => setPopFlavor(e.target.value)} className={inputCls}>
            <option value="">Cake flavor…</option>
            {POP_FLAVORS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select value={chocolateDip} onChange={(e) => setChocolateDip(e.target.value)} className={inputCls}>
            <option value="">Chocolate dip…</option>
            {DIPS.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select value={toppingStyle} onChange={(e) => setToppingStyle(e.target.value)} className={inputCls}>
            <option value="">Topping style…</option>
            {TOPPING_STYLES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <select value={popQtyPick} onChange={(e) => setPopQtyPick(e.target.value)} className={inputCls}>
              <option value="">Quantity…</option>
              {["6", "12", "24", "custom"].map((q) => (
                <option key={q} value={q}>{q === "custom" ? "Custom" : q}</option>
              ))}
            </select>
            {showQtyCustom && (
              <input
                type="number"
                min="1"
                value={popQtyCustom}
                onChange={(e) => setPopQtyCustom(e.target.value)}
                placeholder="Qty"
                className="w-24 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
              />
            )}
          </div>
          <input value={popTheme} onChange={(e) => setPopTheme(e.target.value)} placeholder="Design theme" className={inputCls} />
        </>
      )}

      {itemType === "cupcakes" && (
        <>
          <select value={cupFlavor} onChange={(e) => setCupFlavor(e.target.value)} className={inputCls}>
            <option value="">Cake flavor…</option>
            {POP_FLAVORS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <select value={cupFrosting} onChange={(e) => setCupFrosting(e.target.value)} className={inputCls}>
            <option value="">Frosting…</option>
            {FROSTING_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <select value={cupQtyPick} onChange={(e) => setCupQtyPick(e.target.value)} className={inputCls}>
              <option value="">Quantity…</option>
              {["6", "12", "24", "custom"].map((q) => (
                <option key={q} value={q}>{q === "custom" ? "Custom" : q}</option>
              ))}
            </select>
            {showQtyCustom && (
              <input
                type="number"
                min="1"
                value={cupQtyCustom}
                onChange={(e) => setCupQtyCustom(e.target.value)}
                placeholder="Qty"
                className="w-24 rounded-xl border border-sand-200 px-3 py-2 text-sm outline-none focus:border-palm"
              />
            )}
          </div>
        </>
      )}

      {itemType === "custom" && (
        <>
          <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Item name *" className={inputCls} />
          <textarea value={customDesc} onChange={(e) => setCustomDesc(e.target.value)} rows={2} placeholder="Description" className={inputCls} />
          <input
            type="number"
            min="1"
            value={customQty}
            onChange={(e) => setCustomQty(e.target.value)}
            placeholder="Quantity"
            className={inputCls}
          />
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <button onClick={onCancel} className="rounded-xl border border-sand-200 px-3 py-1.5 text-xs font-medium text-cocoa-muted hover:border-sand-300">
            Cancel
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={!composeValid || submitting}
          title={composeValid ? submitLabel : "Complete the required fields first"}
          className="rounded-xl bg-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-coral/80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
