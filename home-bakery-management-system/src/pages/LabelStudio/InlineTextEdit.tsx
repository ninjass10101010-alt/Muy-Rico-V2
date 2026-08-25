import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, RefObject } from "react";
import type { BusinessProfile, LabelElement, LabelElementField, LabelTemplate } from "../../types";
import { effectiveText } from "./labelMath";
import { firstFamily } from "./capture";
import { useEditorStore } from "./state";

/**
 * Fields whose rendered text round-trips cleanly through `updateField`.
 * Composite/derived text is excluded from inline editing:
 *  - businessId  → phone · registration OR address (two sources, no single key)
 *  - bestBy      → "Best by {date}" (derived from bestByDate/bestByDays)
 *  - disclaimer  → fixed legal text (locked via LayersTab)
 */
const INLINE_EDITABLE_FIELDS: ReadonlySet<LabelElementField> = new Set([
  "businessName",
  "productName",
  "details",
  "ingredients",
  "allergens",
  "netWeight",
  "price",
]);

export function isInlineEditable(el: LabelElement): boolean {
  return el.type === "text" && (el.field === undefined || INLINE_EDITABLE_FIELDS.has(el.field));
}

/** Read/write bridge between the textarea and the store, scoped to one element. */
interface WriteSession {
  /** Current store-space value (fresh read via getState). */
  read: () => string;
  /** Write a textarea value back to the store (record=false while typing). */
  write: (value: string, record?: boolean) => void;
  /** Store-space value at edit start, for Esc restore. */
  snapshot: string;
}

function sessionFor(el: LabelElement, label: LabelTemplate): WriteSession | null {
  const st = useEditorStore.getState();
  if (el.field === undefined) {
    return {
      read: () => useEditorStore.getState().doc.elements.find((e) => e.id === el.id)?.text ?? "",
      write: (value, record) => st.patchElement(el.id, { text: value }, record),
      snapshot: el.text ?? "",
    };
  }
  switch (el.field) {
    case "businessName":
      return {
        read: () => useEditorStore.getState().doc.businessName,
        write: (v, r) => st.updateField("businessName", v, r),
        snapshot: label.businessName,
      };
    case "productName":
      return {
        read: () => useEditorStore.getState().doc.productName,
        write: (v, r) => st.updateField("productName", v, r),
        snapshot: label.productName,
      };
    case "details":
      return {
        read: () => useEditorStore.getState().doc.details,
        write: (v, r) => st.updateField("details", v, r),
        snapshot: label.details,
      };
    case "ingredients":
      // Canvas shows "Ingredients: {value}"; strip the prefix on write so the
      // stored field never accumulates a duplicated prefix.
      return {
        read: () => useEditorStore.getState().doc.ingredients,
        write: (v, r) => st.updateField("ingredients", v.replace(/^Ingredients:\s*/i, ""), r),
        snapshot: label.ingredients,
      };
    case "allergens":
      return {
        read: () => useEditorStore.getState().doc.allergens,
        write: (v, r) => st.updateField("allergens", v, r),
        snapshot: label.allergens,
      };
    case "netWeight": {
      // effectiveText prefers netWeightUS, falls back to netWeight; write back
      // to whichever source actually rendered.
      const key = label.netWeightUS ? "netWeightUS" : "netWeight";
      return {
        read: () => useEditorStore.getState().doc[key],
        write: (v, r) => st.updateField(key, v, r),
        snapshot: label[key],
      };
    }
    case "price":
      return {
        read: () => useEditorStore.getState().doc.price,
        write: (v, r) => st.updateField("price", v, r),
        snapshot: label.price,
      };
    default:
      return null;
  }
}

function isLightColor(color: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || "");
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

interface Props {
  el: LabelElement;
  label: LabelTemplate;
  profile: BusinessProfile;
  W: number;
  H: number;
  panX: number;
  panY: number;
  bestByStr: string;
  containerRef: RefObject<HTMLDivElement | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
}

/**
 * Floating textarea over the stage container at the element's screen rect.
 *
 * Position math: the Konva Stage sits inside `containerRef` at (panX, panY)
 * with scaleX=scaleY=1 (zoom is baked into W/H via pxPerIn = 96*baseScale*zoom/100),
 * so an element's box maps to screen pixels 1:1:
 *   screen = containerRect + (panX + el.x*W, panY + el.y*H), size (el.w*W, el.h*H).
 * Element rotation is IGNORED for editing v1 — the overlay is axis-aligned at the
 * unrotated box (the rotated render stays visible underneath).
 *
 * Undo/coalescing: the session's FIRST store change is recorded (its pre-edit
 * doc becomes the undo target); every following keystroke mutates with
 * record=false (no history); Done/blur pushes ONE checkpoint via
 * setDoc(doc, true) — a trailing marker that clears `future` and stops undo
 * from skipping over the session. Same pattern as arrow-key coalescing in
 * index.tsx: undo #1 lands on the session's end state (appears no-op), undo
 * #2 reverts to pre-edit.
 *
 * Esc/cancel: record=false writes already mutated the live doc, so Esc restores
 * the session's store-space snapshot (field value or el.text) with record=false —
 * doc content is byte-identical to edit start and no phantom text mutations
 * remain. The session's recorded first change leaves one no-op undo entry
 * (after Esc, a single undo press appears to do nothing; the next press reverts
 * the prior real action). If the doc was clean at edit start, dirty is re-cleared.
 *
 * iPad: visualViewport resize/scroll repositions the Done pill above the
 * keyboard; the textarea font is clamped to >=16px so iOS never auto-zooms on
 * focus (visual size tradeoff vs the rendered label is accepted).
 */
export default function InlineTextEdit({
  el,
  label,
  profile,
  W,
  H,
  panX,
  panY,
  bestByStr,
  containerRef,
  wrapperRef,
}: Props) {
  const initialText =
    el.field === undefined ? el.text ?? "" : effectiveText(el, label, profile, bestByStr);
  const [value, setValue] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const finishedRef = useRef(false);
  const recordedRef = useRef(false);
  const sessionRef = useRef<WriteSession | null>(sessionFor(el, label));
  const wasDirtyRef = useRef(useEditorStore.getState().dirty);
  const [, setTick] = useState(0);

  const finish = useCallback((commit: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const st = useEditorStore.getState();
    const session = sessionRef.current;
    if (session && session.read() !== session.snapshot) {
      if (commit) {
        st.setDoc(st.doc, true); // checkpoint: one undo entry per editing session
      } else {
        session.write(session.snapshot, false); // Esc: restore, no history impact
        if (!wasDirtyRef.current) st.markClean();
      }
    }
    st.setEditingId(null);
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    if (ta.value.length > 0) ta.setSelectionRange(0, ta.value.length);
  }, []);

  // Commit on unmount: `select()` (canvas/element click) and other store paths
  // clear editingId without the textarea ever blurring — without this,
  // record=false typing writes would remain in the doc with NO history entry.
  // The macrotask delay + remount cancel keeps React StrictMode's dev
  // double-mount from false-committing.
  const pendingCommitRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingCommitRef.current !== null) {
      window.clearTimeout(pendingCommitRef.current);
      pendingCommitRef.current = null;
    }
    return () => {
      pendingCommitRef.current = window.setTimeout(() => {
        pendingCommitRef.current = null;
        finish(true);
      }, 0);
    };
  }, [finish]);

  useEffect(() => {
    const w = wrapperRef.current;
    if (!w || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(w);
    return () => ro.disconnect();
  }, [wrapperRef]);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", bump);
      vv.addEventListener("scroll", bump);
    }
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    return () => {
      if (vv) {
        vv.removeEventListener("resize", bump);
        vv.removeEventListener("scroll", bump);
      }
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
    };
  }, []);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    // First change of the session is recorded so its pre-edit doc becomes the
    // undo target; the rest are record=false (no history churn while typing).
    sessionRef.current?.write(v, !recordedRef.current);
    recordedRef.current = true;
  };

  const cRect = containerRef.current?.getBoundingClientRect();
  const wRect = wrapperRef.current?.getBoundingClientRect();
  const baseLeft = (cRect?.left ?? 0) - (wRect?.left ?? 0);
  const baseTop = (cRect?.top ?? 0) - (wRect?.top ?? 0);
  const left = baseLeft + panX + el.x * W;
  const top = baseTop + panY + el.y * H;
  const width = el.w * W;
  const height = el.h * H;
  const containerBottom = baseTop + (cRect?.height ?? 0);

  const baseFont = ((el.fontSizeOverride ?? 4) / 100) * W;
  const fontSize = Math.max(16, baseFont);
  const color = el.colorOverride || label.textColor;
  const bg = isLightColor(color) ? "rgba(0,0,0,0.42)" : "rgba(255,255,255,0.92)";

  const PILL_H = 34;
  const GAP = 8;
  let pillTop = top + height + GAP;
  if (pillTop + PILL_H > containerBottom) pillTop = top - PILL_H - GAP;
  const vv = window.visualViewport;
  if (vv) {
    const kbTop = vv.offsetTop + vv.height; // keyboard top in layout coords
    const pillBottom = (wRect?.top ?? 0) + pillTop + PILL_H;
    if (pillBottom > kbTop - 8) {
      pillTop = Math.max(baseTop + 4, pillTop - (pillBottom - (kbTop - 8)));
    }
  }

  return (
    <>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            finish(false);
          }
        }}
        spellCheck={false}
        aria-label="Edit label text"
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          zIndex: 30,
          boxSizing: "border-box",
          margin: 0,
          padding: 2,
          resize: "none",
          overflow: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: firstFamily(el.fontFamilyOverride || label.font),
          fontWeight: el.bold ? 700 : 400,
          fontStyle: el.italic ? "italic" : "normal",
          textDecoration: el.underline ? "underline" : "none",
          fontSize,
          lineHeight: 1.2,
          color,
          textAlign: el.alignOverride || "center",
          background: bg,
          border: "2px solid rgba(244,63,94,0.85)",
          borderRadius: 4,
          outline: "none",
        }}
      />
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => finish(true)}
        onPointerUp={() => finish(true)}
        style={{
          position: "absolute",
          left: left + width / 2,
          top: pillTop,
          height: PILL_H,
          transform: "translateX(-50%)",
          zIndex: 31,
        }}
        className="flex items-center justify-center rounded-full bg-palm px-4 text-xs font-semibold text-white shadow-md"
      >
        Done
      </button>
    </>
  );
}
