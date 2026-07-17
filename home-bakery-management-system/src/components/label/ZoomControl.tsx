import { ZoomIn, ZoomOut } from "lucide-react";

interface Props {
  zoom: number;
  onChange: (z: number) => void;
}

export default function ZoomControl({ zoom, onChange }: Props) {
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(Number(e.target.value));
  }

  return (
    <div className="flex items-center gap-2">
      <ZoomOut size={14} className="text-cocoa-muted" />
      <input
        type="range"
        min={25}
        max={200}
        step={5}
        value={zoom}
        onChange={handleChange}
        className="w-24 accent-coral"
      />
      <ZoomIn size={14} className="text-cocoa-muted" />
      <span className="w-10 text-right text-xs tabular-nums text-cocoa-muted">{zoom}%</span>
    </div>
  );
}
