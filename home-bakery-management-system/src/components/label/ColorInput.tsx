interface Props {
  value: string;
  onChange: (value: string) => void;
  onReset?: () => void;
}

export default function ColorInput({ value, onChange, onReset }: Props) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-transparent p-0.5">
      <input
        type="color"
        value={value === "transparent" ? "#ffffff" : value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-6 cursor-pointer rounded border-none bg-transparent p-0"
      />
      <span className="min-w-[52px] font-mono text-[10px] text-cocoa-muted">{value}</span>
      {onReset && (
        <button
          type="button"
          className="text-[10px] text-cocoa-muted underline"
          onClick={onReset}
        >
          Reset
        </button>
      )}
    </div>
  );
}
