import { Repeat } from "lucide-react";
import { usToMetricUS } from "../../utils/compliance";
import { useState } from "react";

interface Props {
  netWeightUS: string;
  netWeightMetric: string;
  onChange: (us: string, metric: string) => void;
}

export default function NetWeightInput({ netWeightUS, netWeightMetric, onChange }: Props) {
  const [unitType, setUnitType] = useState<"weight" | "volume">("weight");

  function handleConvert() {
    const metric = usToMetricUS(netWeightUS);
    if (metric) {
      onChange(netWeightUS, metric);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setUnitType("weight")}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium ${
            unitType === "weight"
              ? "border-palm bg-palm text-white"
              : "border-sand-200 text-cocoa-muted"
          }`}
        >
          Weight
        </button>
        <button
          type="button"
          onClick={() => setUnitType("volume")}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium ${
            unitType === "volume"
              ? "border-palm bg-palm text-white"
              : "border-sand-200 text-cocoa-muted"
          }`}
        >
          Volume
        </button>
      </div>

      <div className="flex items-start gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-[10px] text-cocoa-muted">US</label>
          <input
            value={netWeightUS}
            onChange={(e) => onChange(e.target.value, netWeightMetric)}
            placeholder={unitType === "weight" ? "e.g. 3 oz" : "e.g. 8 fl oz"}
            className="input"
          />
        </div>
        <button
          type="button"
          onClick={handleConvert}
          className="mt-5 flex items-center gap-1 rounded-lg border border-sand-300 px-2 py-1.5 text-[10px] font-medium text-cocoa-muted hover:bg-sand-50"
          title="Convert US to metric"
        >
          <Repeat size={10} />
          Convert
        </button>
        <div className="flex-1 space-y-1">
          <label className="text-[10px] text-cocoa-muted">Metric</label>
          <input
            value={netWeightMetric}
            onChange={(e) => onChange(netWeightUS, e.target.value)}
            placeholder={unitType === "weight" ? "e.g. 85 g" : "e.g. 237 mL"}
            className="input"
          />
        </div>
      </div>
    </div>
  );
}
