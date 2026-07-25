export default function ProductIcon({ emoji, size = 18, className = "" }: {
  emoji?: string | null;
  size?: number;
  className?: string;
}) {
  if (emoji && emoji.endsWith(".svg")) {
    return (
      <img
        src={`/${emoji}`}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "contain", display: "inline-block", verticalAlign: "middle" }}
      />
    );
  }
  return (
    <span className={className} style={{ fontSize: size, lineHeight: 1 }}>
      {emoji || "\u{1F35E}"}
    </span>
  );
}
