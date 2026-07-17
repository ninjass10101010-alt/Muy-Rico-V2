import { useMemo, useRef, useState } from "react";
import type { BusinessProfile, LabelElement, LabelTemplate } from "../../types";
import { effectiveDimensions, ensureElements } from "./defaultElements";
import { useElementDrag } from "./useElementDrag";
import LabelElementView from "./LabelElementView";
import ElementToolbar from "./ElementToolbar";
import ZoomControl from "./ZoomControl";
import { newId } from "../../utils/format";

interface Props {
  label: LabelTemplate;
  profile: BusinessProfile;
  onChangeElements: (elements: LabelElement[]) => void;
  onUpdateField: <K extends keyof LabelTemplate>(key: K, value: LabelTemplate[K]) => void;
  previewRef: React.RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
}

export default function LabelCanvas({
  label,
  profile,
  onChangeElements,
  onUpdateField,
  previewRef,
  selectedId,
  onSelect,
  zoom,
  onZoomChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const elements = useMemo(() => ensureElements(label), [label]);
  const { effW, effH, isSquareShape } = effectiveDimensions(
    label.labelWidth,
    label.labelHeight,
    label.shape,
    label.orientation || "portrait"
  );
  const isCurved = label.shape === "circle" || label.shape === "oval";
  const padClass = isCurved ? "p-[6%]" : "p-[3%]";

  const { onPointerDown, onPointerMove, onPointerUp } = useElementDrag(
    elements,
    onChangeElements,
    containerRef
  );

  const selected = elements.find((e) => e.id === selectedId) || null;
  const bestByDate = new Date();
  bestByDate.setDate(bestByDate.getDate() + label.bestByDays);

  function patchSelected(patch: Partial<LabelElement>) {
    if (!selected) return;
    onChangeElements(elements.map((e) => (e.id === selected.id ? { ...e, ...patch } : e)));
  }

  function bringFront() {
    if (!selected) return;
    const maxZ = Math.max(...elements.map((e) => e.z), 0);
    patchSelected({ z: maxZ + 1 });
  }

  function sendBack() {
    if (!selected) return;
    const minZ = Math.min(...elements.map((e) => e.z), 0);
    patchSelected({ z: minZ - 1 });
  }

  function duplicate() {
    if (!selected) return;
    const copy: LabelElement = {
      ...selected,
      id: newId("el"),
      x: Math.min(selected.x + 0.03, 1 - selected.w),
      y: Math.min(selected.y + 0.03, 1 - selected.h),
      z: selected.z + 1,
    };
    onChangeElements([...elements, copy]);
    onSelect(copy.id);
  }

  function toggleHide() {
    if (!selected) return;
    if (selected.field === "disclaimer") {
      onUpdateField("showDisclaimer", selected.hidden ? true : false);
    }
    patchSelected({ hidden: !selected.hidden });
  }

  function toggleLock() {
    patchSelected({ lock: !selected?.lock });
  }

  function deleteEl() {
    if (!selected) return;
    if (selected.field === "disclaimer") return;
    onChangeElements(elements.filter((e) => e.id !== selected.id));
    onSelect(null);
  }

  function onTextCommit(field: string, value: string) {
    const key = field as keyof LabelTemplate;
    onUpdateField(key, value as never);
  }

  const sorted = [...elements].sort((a, b) => a.z - b.z);

  return (
    <div className="relative flex min-h-[500px] w-full flex-col items-center rounded-3xl border border-dashed border-sand-300 bg-sand-100 p-6">
      {/* Zoom control */}
      <div className="deco-layer mb-3 w-full max-w-[340px]">
        <ZoomControl zoom={zoom} onChange={onZoomChange} />
      </div>

      <div
        className="relative flex min-h-[400px] w-full items-start justify-center overflow-auto"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {selected && (
          <div className="deco-layer absolute top-1 left-1/2 z-50 -translate-x-1/2">
            <ElementToolbar
              el={selected}
              onBringFront={bringFront}
              onSendBack={sendBack}
              onDuplicate={duplicate}
              onToggleHide={toggleHide}
              onToggleLock={toggleLock}
              onDelete={deleteEl}
              canDelete={selected.field !== "disclaimer"}
            />
          </div>
        )}

        <div
          id="print-label"
          ref={previewRef as React.RefObject<HTMLDivElement>}
          className="w-full max-w-[340px] origin-top transition-transform"
          style={{
            aspectRatio: `${effW} / ${effH}`,
            transform: `scale(${zoom})`,
          }}
        >
          <div
            ref={containerRef}
            className={`relative h-full w-full overflow-hidden border-4 ${padClass} shadow-xl ${
              label.shape === "circle"
                ? "rounded-full"
                : label.shape === "oval"
                  ? "rounded-[50%]"
                  : label.shape === "square"
                    ? "rounded-lg"
                    : "rounded-3xl"
            }`}
            style={{
              backgroundColor: label.bgColor,
              borderColor: label.accentColor,
              color: label.textColor,
              fontFamily: label.font,
              containerType: "inline-size",
              backgroundImage: label.bgImage ? `url(${label.bgImage})` : undefined,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            onClick={() => {
              onSelect(null);
              setEditingId(null);
            }}
          >
            {/* Safe margin indicator (export-ignored) */}
            <div
              className="deco-layer pointer-events-none absolute inset-[3%] border border-dashed border-black/10"
              style={{
                borderRadius:
                  label.shape === "circle" || label.shape === "oval"
                    ? "50%"
                    : label.shape === "square"
                      ? 8
                      : 12,
              }}
            />

            {sorted.map((el) => (
              <LabelElementView
                key={el.id}
                el={el}
                label={{ ...label, elements }}
                profile={profile}
                selected={selectedId === el.id}
                bestByDate={bestByDate}
                onSelect={onSelect}
                onPointerDown={(e, element, handle) => {
                  onSelect(element.id);
                  onPointerDown(e, element, handle as never);
                }}
                onDoubleClick={(element) => setEditingId(element.id)}
                editingId={editingId}
                onTextCommit={onTextCommit}
                onStopEdit={() => setEditingId(null)}
              />
            ))}
          </div>
        </div>
      </div>

      <p className="deco-layer mt-3 text-[10px] text-cocoa-muted">
        {effW}&quot; × {effH}&quot;
        {isSquareShape ? " · square" : ` · ${label.orientation || "portrait"}`}
        {" · drag to move · handles to resize · top knob to rotate"}
      </p>
    </div>
  );
}
