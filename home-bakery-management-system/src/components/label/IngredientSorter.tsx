import { ArrowUpDown } from "lucide-react";

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function IngredientSorter({ value, onChange }: Props) {
  function sortAndValidate() {
    const lines = value.split("\n").filter((l) => l.trim());
    const parsed = lines.map((line) => {
      const match = line.match(/^(\d+(?:\.\d+)?%)\s*(.+)$/);
      if (match) {
        return { weight: parseFloat(match[1]), text: match[2], original: line };
      }
      return { weight: 0, text: line, original: line };
    });

    parsed.sort((a, b) => b.weight - a.weight);

    const result = parsed.map((p) => {
      if (p.weight > 0) {
        return `${p.weight}% ${p.text}`;
      }
      return p.text;
    });

    onChange(result.join("\n"));
  }

  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ingredients (descending by weight)"
        rows={4}
        className="input"
      />
      <button
        type="button"
        onClick={sortAndValidate}
        className="flex items-center gap-1 rounded-lg border border-sand-300 px-2.5 py-1.5 text-xs font-medium text-cocoa-muted hover:bg-sand-50"
      >
        <ArrowUpDown size={12} />
        Sort & validate
      </button>
    </div>
  );
}
