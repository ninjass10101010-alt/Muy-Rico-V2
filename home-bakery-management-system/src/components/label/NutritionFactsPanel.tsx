import type { NfpData } from "../../types";

interface Props {
  nfpData: NfpData;
  onChange?: (data: NfpData) => void;
  editable?: boolean;
}

const DV_THRESHOLDS: Record<string, number> = {
  totalFat: 78,
  satFat: 20,
  cholesterol: 300,
  sodium: 2300,
  totalCarb: 275,
  fiber: 28,
  addedSugars: 50,
  vitD: 20,
  calcium: 1300,
  iron: 18,
  potassium: 4700,
};

const DV_FIELDS = new Set(Object.keys(DV_THRESHOLDS));

function dvPercent(value: string, field: string): string {
  const v = parseFloat(value);
  if (isNaN(v) || v <= 0 || !DV_FIELDS.has(field) || !DV_THRESHOLDS[field]) return "";
  return `${Math.round((v / DV_THRESHOLDS[field]) * 100)}%`;
}

function InputField({ value, onChange, label }: { value: string; onChange?: (v: string) => void; label: string }) {
  if (onChange) {
    return (
      <input
        className="w-full bg-transparent text-right text-[inherit] outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
      />
    );
  }
  return <span className="text-right">{value || label}</span>;
}

export default function NutritionFactsPanel({ nfpData, onChange, editable }: Props) {
  const edit = editable && onChange;

  function set<K extends keyof NfpData>(key: K, value: string) {
    if (!onChange) return;
    onChange({ ...nfpData, [key]: value });
  }

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden border-2 border-black bg-white p-[2cqw] text-[2.5cqw] leading-tight text-black"
      style={{ fontFamily: "'Arial', 'Helvetica', sans-serif" }}
    >
      <div className="border-b-4 border-black text-[3.5cqw] font-[900] leading-none tracking-tight">
        Nutrition Facts
      </div>

      <div className="mt-[0.5cqw] border-b border-black pb-[0.5cqw]">
        <Row>
          <span className="font-bold">Serving Size</span>
          <InputField value={nfpData.servingSize} onChange={edit ? (v) => set("servingSize", v) : undefined} label="1 serving" />
        </Row>
        <Row>
          <span className="font-bold">Servings Per Container</span>
          <InputField value={nfpData.servings} onChange={edit ? (v) => set("servings", v) : undefined} label="1" />
        </Row>
      </div>

      <div className="border-b-4 border-black pb-[0.3cqw]">
        <Row>
          <span className="font-bold">Calories</span>
          <InputField value={nfpData.calories} onChange={edit ? (v) => set("calories", v) : undefined} label="0" />
        </Row>
      </div>

      <HeaderRow label="% Daily Value*" />

      <NutrientRow label="Total Fat" value={nfpData.totalFat} dvField="totalFat" onChange={edit ? (v) => set("totalFat", v) : undefined} bold>
        <SubNutrient label="Saturated Fat" value={nfpData.satFat} dvField="satFat" onChange={edit ? (v) => set("satFat", v) : undefined} />
        <SubNutrient label="Trans Fat" value={nfpData.transFat} onChange={edit ? (v) => set("transFat", v) : undefined} />
      </NutrientRow>

      <NutrientRow label="Cholesterol" value={nfpData.cholesterol} dvField="cholesterol" onChange={edit ? (v) => set("cholesterol", v) : undefined} />
      <NutrientRow label="Sodium" value={nfpData.sodium} dvField="sodium" onChange={edit ? (v) => set("sodium", v) : undefined} />

      <NutrientRow label="Total Carbohydrate" value={nfpData.totalCarb} dvField="totalCarb" onChange={edit ? (v) => set("totalCarb", v) : undefined} bold>
        <SubNutrient label="Dietary Fiber" value={nfpData.fiber} dvField="fiber" onChange={edit ? (v) => set("fiber", v) : undefined} />
        <SubNutrient label="Total Sugars" value={nfpData.sugars} onChange={edit ? (v) => set("sugars", v) : undefined} />
        <SubNutrient label="Includes Added Sugars" value={nfpData.addedSugars} dvField="addedSugars" onChange={edit ? (v) => set("addedSugars", v) : undefined} />
      </NutrientRow>

      <NutrientRow label="Protein" value={nfpData.protein} onChange={edit ? (v) => set("protein", v) : undefined} bold />

      <div className="mt-[0.3cqw] border-t-2 border-black pt-[0.3cqw]">
        <VitaminRow label="Vitamin D" value={nfpData.vitD} dvField="vitD" onChange={edit ? (v) => set("vitD", v) : undefined} />
        <VitaminRow label="Calcium" value={nfpData.calcium} dvField="calcium" onChange={edit ? (v) => set("calcium", v) : undefined} />
        <VitaminRow label="Iron" value={nfpData.iron} dvField="iron" onChange={edit ? (v) => set("iron", v) : undefined} />
        <VitaminRow label="Potassium" value={nfpData.potassium} dvField="potassium" onChange={edit ? (v) => set("potassium", v) : undefined} />
        <VitaminRow label="Vitamin A" value={nfpData.vitA} onChange={edit ? (v) => set("vitA", v) : undefined} />
        <VitaminRow label="Vitamin C" value={nfpData.vitC} onChange={edit ? (v) => set("vitC", v) : undefined} />
      </div>

      <div className="mt-[0.3cqw] border-t border-black pt-[0.3cqw] text-[2cqw]">
        * The % Daily Value tells you how much a nutrient in a serving of food contributes to a daily diet.
      </div>
    </div>
  );
}

function Row({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`flex items-baseline justify-between gap-1 ${className}`}>{children}</div>;
}

function HeaderRow({ label }: { label: string }) {
  return (
    <div className="border-b border-black pt-[0.3cqw] text-right text-[2cqw] font-bold">
      {label}
    </div>
  );
}

function NutrientRow({
  label,
  value,
  dvField,
  onChange,
  bold,
  children,
}: {
  label: string;
  value: string;
  dvField?: string;
  onChange?: (v: string) => void;
  bold?: boolean;
  children?: React.ReactNode;
}) {
  const dv = dvField ? dvPercent(value, dvField) : "";
  return (
    <div className="border-b border-black pb-[0.2cqw] pt-[0.2cqw]">
      <Row>
        <span className={`${bold ? "font-[800]" : ""}`}>{label}</span>
        <div className="flex items-center gap-1">
          {onChange ? (
            <input
              className="w-8 bg-transparent text-right text-[inherit] outline-none"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="0"
            />
          ) : (
            <span>{value || "0"}</span>
          )}
          {dv && <span className="min-w-[3.5cqw] text-right font-bold">{dv}</span>}
        </div>
      </Row>
      {children}
    </div>
  );
}

function SubNutrient({
  label,
  value,
  dvField,
  onChange,
}: {
  label: string;
  value: string;
  dvField?: string;
  onChange?: (v: string) => void;
}) {
  const dv = dvField ? dvPercent(value, dvField) : "";
  return (
    <Row className="ml-[2cqw] text-[2.2cqw]">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        {onChange ? (
          <input
            className="w-7 bg-transparent text-right text-[inherit] outline-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
          />
        ) : (
          <span>{value || "0"}</span>
        )}
        {dv && <span className="min-w-[3.5cqw] text-right font-bold">{dv}</span>}
      </div>
    </Row>
  );
}

function VitaminRow({
  label,
  value,
  dvField,
  onChange,
}: {
  label: string;
  value: string;
  dvField?: string;
  onChange?: (v: string) => void;
}) {
  const dv = dvField ? dvPercent(value, dvField) : "";
  return (
    <Row className="py-[0.1cqw]">
      <span>{label}</span>
      <div className="flex items-center gap-1">
        <InputField value={value} onChange={onChange} label="0mcg" />
        {dv && <span className="min-w-[3.5cqw] text-right font-bold">{dv}</span>}
      </div>
    </Row>
  );
}
