import { useState } from "react";
import { Mail, Phone, FileText } from "lucide-react";
import Modal from "./ui/Modal";
import { formatCurrency } from "../utils/format";
import { apiMergeCustomers } from "../utils/api";
import type { Customer } from "../types";
import type { DuplicatePair } from "../utils/api";

interface MergeModalProps {
  open: boolean;
  onClose: () => void;
  pair: DuplicatePair | null;
  stats: Record<string, { count: number; total: number }>;
  onMerged: () => void;
}

export default function MergeModal({ open, onClose, pair, stats, onMerged }: MergeModalProps) {
  const [survivingSide, setSurvivingSide] = useState<"left" | "right">("left");
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState("");

  if (!pair) return null;

  const left = pair.survivingCandidate;
  const right = pair.mergedCandidate;
  const surviving = survivingSide === "left" ? left : right;
  const merged = survivingSide === "left" ? right : left;
  const leftStats = stats[left.id] || { count: 0, total: 0 };
  const rightStats = stats[right.id] || { count: 0, total: 0 };

  const confidenceLabel = {
    high: "Email match",
    medium: "Phone + name match",
    low: "Name only",
  }[pair.confidence] || pair.matchedBy;

  async function handleMerge() {
    setMerging(true);
    setError("");
    try {
      await apiMergeCustomers(surviving.id, merged.id);
      onMerged();
      onClose();
    } catch (err: any) {
      setError(err.message || "Merge failed");
    } finally {
      setMerging(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Review Duplicate">
      <div className="space-y-4">
        {/* Confidence chip */}
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            {confidenceLabel}
          </span>
        </div>

        {/* Side-by-side comparison */}
        <div className="grid grid-cols-2 gap-3">
          {[left, right].map((c, i) => {
            const side = i === 0 ? "left" : "right";
            const s = i === 0 ? leftStats : rightStats;
            const isSurviving = survivingSide === side;
            return (
              <div
                key={c.id}
                className={`rounded-xl border-2 p-4 transition ${
                  isSurviving ? "border-palm bg-palm/5" : "border-sand-200 bg-white"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-semibold text-cocoa">{c.name}</p>
                  <input
                    type="radio"
                    name="surviving"
                    checked={isSurviving}
                    onChange={() => setSurvivingSide(side)}
                    className="accent-palm"
                  />
                </div>
                <p className="text-xs text-cocoa-muted">
                  {isSurviving ? "Surviving record" : "Will be merged away"}
                </p>
                <div className="mt-3 space-y-1 text-xs text-cocoa-muted">
                  {c.phone && (
                    <p className="flex items-center gap-1.5">
                      <Phone size={12} /> {c.phone}
                    </p>
                  )}
                  {c.email && (
                    <p className="flex items-center gap-1.5">
                      <Mail size={12} /> {c.email}
                    </p>
                  )}
                  {c.notes && (
                    <p className="flex items-center gap-1.5">
                      <FileText size={12} /> {c.notes}
                    </p>
                  )}
                </div>
                <div className="mt-3 rounded-lg bg-sand-50 px-3 py-2 text-sm">
                  <span className="text-cocoa-muted">{s.count} orders</span>
                  <span className="mx-1.5 text-cocoa-muted">·</span>
                  <span className="font-semibold text-cocoa">{formatCurrency(s.total)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <p className="rounded-lg bg-hibiscus-light/10 px-3 py-2 text-xs text-hibiscus">{error}</p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-sand-200 py-2.5 text-sm font-medium text-cocoa-muted hover:bg-sand-50"
          >
            Dismiss
          </button>
          <button
            onClick={handleMerge}
            disabled={merging}
            className="flex-1 rounded-xl bg-palm py-2.5 text-sm font-semibold text-white transition hover:shadow-md disabled:opacity-50"
          >
            {merging ? "Merging..." : "Approve Merge"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
