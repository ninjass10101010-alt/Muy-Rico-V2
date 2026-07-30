export default function ProductIcon({ emoji, imageUrl, size = 18, className = "" }: {
  emoji?: string | null;
  imageUrl?: string | null;
  size?: number;
  className?: string;
}) {
  // Prefer the uploaded R2 product photo when available
  if (imageUrl && /^https?:\/\//.test(imageUrl)) {
    return (
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "cover", borderRadius: size > 28 ? 8 : 4, display: "inline-block", verticalAlign: "middle" }}
      />
    );
  }
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
