import { X } from "lucide-react";
import type { ReactNode } from "react";

export default function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-palm/40 p-4 backdrop-blur-sm sm:items-center">
      <div
        className={`my-8 w-full ${wide ? "max-w-3xl" : "max-w-lg"} rounded-[40px_12px_40px_12px] bg-white shadow-2xl ring-1 ring-black/5`}
      >
        <div className="flex items-center justify-between border-b border-sand-100 px-6 py-4">
          <h3 className="font-serif text-lg font-semibold text-cocoa">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-cocoa-muted transition hover:bg-sand-100 hover:text-cocoa"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
