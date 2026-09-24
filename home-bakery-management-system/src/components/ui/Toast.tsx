import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { cn } from "../../utils/cn";

type ToastTone = "success" | "error";

interface ToastEntry {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  success: (message: string) => void;
  error: (message: string) => void;
}

const AUTO_DISMISS_MS = 3500;

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => push("success", message),
      error: (message) => push("error", message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2"
      >
        {toasts.map((toast) => (
          <button
            key={toast.id}
            onClick={() => dismiss(toast.id)}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border bg-white px-4 py-3 text-left text-sm shadow-lg",
              toast.tone === "success" ? "border-palm/30" : "border-hibiscus/30",
            )}
          >
            {toast.tone === "success" ? (
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-palm" />
            ) : (
              <XCircle size={16} className="mt-0.5 shrink-0 text-hibiscus" />
            )}
            <span className="min-w-0 flex-1 text-cocoa">{toast.message}</span>
            <X size={14} className="mt-0.5 shrink-0 text-cocoa-muted" />
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
