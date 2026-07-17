import { useState, useRef, useEffect, useCallback } from "react";
import { toPng } from "html-to-image";
import { Edit3, Copy, Trash2, Tag } from "lucide-react";
import type { LabelTemplate } from "../types";
import { effectiveDimensions, ensureElements } from "../components/label/defaultElements";

interface Props {
  templates: LabelTemplate[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export default function LabelProjects({ templates, onEdit, onDelete, onDuplicate }: Props) {
  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Tag size={40} className="text-sand-300" />
        <p className="mt-3 text-sm text-cocoa-muted">No label templates yet</p>
        <p className="text-xs text-cocoa-muted">Create your first label to get started</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
      {templates.map((t) => (
        <LabelCard
          key={t.id}
          template={t}
          onEdit={() => onEdit(t.id)}
          onDelete={() => onDelete(t.id)}
          onDuplicate={() => onDuplicate(t.id)}
        />
      ))}
    </div>
  );
}

function LabelCard({
  template,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  template: LabelTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const { effW, effH } = effectiveDimensions(
    template.labelWidth,
    template.labelHeight,
    template.shape,
    template.orientation || "portrait"
  );

  const generateThumbnail = useCallback(async () => {
    if (!previewRef.current) return;
    try {
      const filter = (node: HTMLElement) =>
        !(node.classList && node.classList.contains("deco-layer"));
      const dataUrl = await toPng(previewRef.current, {
        pixelRatio: 0.5,
        cacheBust: true,
        filter,
      });
      setThumbnail(dataUrl);
    } catch {
      // silently ignore thumbnail failures
    }
  }, []);

  useEffect(() => {
    // Wait a tick for layout to settle
    const id = setTimeout(() => generateThumbnail(), 100);
    return () => clearTimeout(id);
  }, [generateThumbnail]);

  const shapeClass =
    template.shape === "circle"
      ? "rounded-full"
      : template.shape === "oval"
        ? "rounded-[50%]"
        : template.shape === "square"
          ? "rounded-lg"
          : "rounded-xl";

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="flex aspect-[3/4] items-center justify-center bg-sand-50 p-4">
        <div
          ref={previewRef}
          className={`flex h-full w-full items-center justify-center overflow-hidden border-2 ${shapeClass}`}
          style={{
            aspectRatio: `${effW} / ${effH}`,
            backgroundColor: template.bgColor,
            borderColor: template.accentColor,
            color: template.textColor,
            fontFamily: template.font,
            maxHeight: "100%",
          }}
        >
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={template.name}
              className="h-full w-full object-contain"
            />
          ) : (
            <MiniPreview template={template} />
          )}
        </div>
      </div>

      <div className="border-t border-sand-100 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-cocoa">{template.name}</p>
        <p className="text-[11px] text-cocoa-muted">
          {template.labelWidth}&Prime; × {template.labelHeight}&Prime;
        </p>
      </div>

      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={onEdit}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow hover:bg-sand-50"
          title="Edit"
        >
          <Edit3 size={13} className="text-cocoa-muted" />
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow hover:bg-sand-50"
          title="Duplicate"
        >
          <Copy size={13} className="text-cocoa-muted" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-white shadow hover:bg-hibiscus-light/10"
          title="Delete"
        >
          <Trash2 size={13} className="text-hibiscus" />
        </button>
      </div>
    </div>
  );
}

function MiniPreview({ template }: { template: LabelTemplate }) {
  const elements = ensureElements(template);
  const sorted = [...elements].filter((e) => !e.hidden).sort((a, b) => a.z - b.z);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-[6%] text-center text-[6px] leading-tight">
      {sorted.slice(0, 6).map((el) => {
        if (el.type === "text") {
          let label = "";
          if (el.field === "productName") label = template.productName || "Product";
          else if (el.field === "businessName") label = template.businessName || "Business";
          else if (el.field === "price") label = template.price || "$0.00";
          else label = el.field;
          return (
            <span
              key={el.id}
              className="w-full truncate"
              style={{
                fontWeight: el.bold ? 700 : 400,
                fontStyle: el.italic ? "italic" : "normal",
                opacity: el.opacity ?? 1,
              }}
            >
              {label}
            </span>
          );
        }
        if (el.type === "logo") {
          return (
            <span key={el.id} className="text-[16px]">
              {template.logoEmoji || "🏷️"}
            </span>
          );
        }
        return null;
      })}
    </div>
  );
}
