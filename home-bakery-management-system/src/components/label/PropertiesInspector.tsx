import type { LabelElement, LabelTemplate } from "../../types";
import { ptToCqw, cqwToPt } from "../../utils/compliance";
import ColorInput from "./ColorInput";

const FONT_CHOICES = [
  { label: "Elegant Serif", value: "'Cormorant Garamond', Georgia, serif" },
  { label: "Friendly Rounded", value: "'Quicksand', 'Comic Sans MS', sans-serif" },
  { label: "Classic Sans", value: "'Poppins', 'Segoe UI', sans-serif" },
  { label: "Handwritten", value: "'Caveat', cursive" },
];

interface Props {
  el: LabelElement;
  label: LabelTemplate;
  onChange: (patch: Partial<LabelElement>) => void;
}

const NFP_FIELDS: { key: keyof import("../../types").NfpData; label: string }[] = [
  { key: "servingSize", label: "Serving Size" },
  { key: "servings", label: "Servings" },
  { key: "calories", label: "Calories" },
  { key: "totalFat", label: "Total Fat" },
  { key: "satFat", label: "Saturated Fat" },
  { key: "transFat", label: "Trans Fat" },
  { key: "cholesterol", label: "Cholesterol" },
  { key: "sodium", label: "Sodium" },
  { key: "totalCarb", label: "Total Carb" },
  { key: "fiber", label: "Fiber" },
  { key: "sugars", label: "Sugars" },
  { key: "addedSugars", label: "Added Sugars" },
  { key: "protein", label: "Protein" },
  { key: "vitD", label: "Vitamin D" },
  { key: "calcium", label: "Calcium" },
  { key: "iron", label: "Iron" },
  { key: "potassium", label: "Potassium" },
  { key: "vitA", label: "Vitamin A" },
  { key: "vitC", label: "Vitamin C" },
];

export default function PropertiesInspector({ el, label, onChange }: Props) {
  const labelWidthInches = label.labelWidth || 3;

  function ptVal(): number {
    const cqw = el.fontSizeOverride ?? 4;
    return Math.round(cqwToPt(cqw, labelWidthInches) * 10) / 10;
  }

  function onPtChange(pt: number) {
    const cqw = ptToCqw(pt, labelWidthInches);
    onChange({ fontSizeOverride: Math.round(cqw * 100) / 100 });
  }

  const fieldFloor = el.field === "disclaimer" ? 11 : 4.5;
  const currentPt = ptVal();
  const belowFloor = currentPt < fieldFloor;

  return (
    <div className="space-y-2 text-xs">
      {el.type === "text" && (
        <>
          <Row label="Font size">
            <input
              type="range"
              min={4}
              max={72}
              step={0.5}
              value={currentPt}
              onChange={(e) => onPtChange(Number(e.target.value))}
              className="w-full accent-coral"
            />
            <span className="w-12 text-right tabular-nums text-cocoa-muted">
              {currentPt}pt
            </span>
          </Row>
          {belowFloor && (
            <p className="text-[10px] text-hibiscus">
              Minimum {fieldFloor}pt required for &ldquo;{el.field}&rdquo;
            </p>
          )}
          <Row label="Font">
            <select
              value={el.fontFamilyOverride || ""}
              onChange={(e) =>
                onChange({ fontFamilyOverride: e.target.value || undefined })
              }
              className="input text-xs"
            >
              <option value="">Label default</option>
              {FONT_CHOICES.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Color">
            <ColorInput
              value={el.colorOverride || "#4A3222"}
              onChange={(v) => onChange({ colorOverride: v })}
              onReset={() => onChange({ colorOverride: undefined })}
            />
          </Row>
          <Row label="Align">
            <div className="flex gap-1">
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onChange({ alignOverride: a })}
                  className={`rounded border px-2 py-1 text-[10px] capitalize ${
                    (el.alignOverride || "center") === a
                      ? "border-palm bg-palm text-white"
                      : "border-sand-200 text-cocoa-muted"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Style">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={!!el.bold}
                onChange={(e) => onChange({ bold: e.target.checked })}
              />
              Bold
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={!!el.italic}
                onChange={(e) => onChange({ italic: e.target.checked })}
              />
              Italic
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={!!el.underline}
                onChange={(e) => onChange({ underline: e.target.checked })}
              />
              Underline
            </label>
          </Row>
        </>
      )}

      {el.type === "qr" && (
        <>
          <Row label="QR color">
            <ColorInput
              value={el.colorOverride || "#000000"}
              onChange={(v) => onChange({ colorOverride: v })}
            />
          </Row>
          <Row label="Error level">
            <select
              value={el.qrErrorLevel || "M"}
              onChange={(e) =>
                onChange({ qrErrorLevel: e.target.value as LabelElement["qrErrorLevel"] })
              }
              className="input text-xs"
            >
              <option value="L">L (low)</option>
              <option value="M">M (medium)</option>
              <option value="Q">Q (quartile)</option>
              <option value="H">H (high)</option>
            </select>
          </Row>
        </>
      )}

      {(el.type === "rect" || el.type === "circle" || el.type === "line") && (
        <>
          <Row label="Stroke color">
            <ColorInput
              value={el.strokeColor || "#333333"}
              onChange={(v) => onChange({ strokeColor: v })}
              onReset={() => onChange({ strokeColor: undefined })}
            />
          </Row>
          <Row label="Stroke width">
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={el.strokeWidth ?? 2}
              onChange={(e) => onChange({ strokeWidth: Number(e.target.value) })}
              className="w-full accent-coral"
            />
            <span className="w-6 text-right tabular-nums text-cocoa-muted">
              {el.strokeWidth ?? 2}
            </span>
          </Row>
          {(el.type === "rect" || el.type === "circle") && (
            <Row label="Fill color">
              <ColorInput
                value={el.fillColor || "transparent"}
                onChange={(v) => onChange({ fillColor: v })}
                onReset={() => onChange({ fillColor: undefined })}
              />
            </Row>
          )}
        </>
      )}

      {el.type === "nfp" && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold text-cocoa-muted">
            Nutrition Facts
          </summary>
          <div className="mt-2 space-y-1.5">
            {NFP_FIELDS.map(({ key, label: fLabel }) => (
              <Row key={key} label={fLabel}>
                <input
                  className="input flex-1 text-xs"
                  value={(el.nfpData && el.nfpData[key]) || ""}
                  onChange={(e) =>
                    onChange({
                      nfpData: {
                        ...(el.nfpData || {} as import("../../types").NfpData),
                        [key]: e.target.value,
                      } as import("../../types").NfpData,
                    })
                  }
                  placeholder="0"
                />
              </Row>
            ))}
          </div>
        </details>
      )}

      <Row label="Opacity">
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={el.opacity ?? 1}
          onChange={(e) => onChange({ opacity: Number(e.target.value) })}
          className="w-full accent-coral"
        />
        <span className="w-8 text-right tabular-nums text-cocoa-muted">
          {Math.round((el.opacity ?? 1) * 100)}%
        </span>
      </Row>

      <Row label="Rotation">
        <input
          type="range"
          min={0}
          max={359}
          step={1}
          value={el.rotation || 0}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
          className="w-full accent-coral"
        />
        <span className="w-8 text-right tabular-nums text-cocoa-muted">
          {Math.round(el.rotation || 0)}°
        </span>
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-[10px] text-cocoa-muted">{label}</span>
      <div className="flex flex-1 items-center gap-2">{children}</div>
    </div>
  );
}
