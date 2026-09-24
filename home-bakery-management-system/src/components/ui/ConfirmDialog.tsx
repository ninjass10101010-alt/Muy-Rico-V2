import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import Modal from "./Modal";
import { cn } from "../../utils/cn";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setOptions(opts);
      }),
    [],
  );

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal open={!!options} onClose={() => settle(false)} title={options?.title ?? ""}>
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-cocoa-muted">{options?.message}</p>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => settle(false)}
              className="rounded-xl border border-sand-200 px-4 py-2 text-sm font-medium text-cocoa-muted transition hover:bg-sand-100"
            >
              {options?.cancelLabel ?? "Cancel"}
            </button>
            <button
              onClick={() => settle(true)}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:shadow-md",
                options?.danger ? "bg-hibiscus" : "bg-palm",
              )}
            >
              {options?.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
