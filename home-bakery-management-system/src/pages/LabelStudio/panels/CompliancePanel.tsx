import { X } from "lucide-react";
import { useEditorStore } from "../state";

/** Right slide-over drawer. Stub this task — checklist contents land in Task 9. */
export default function CompliancePanel() {
  const open = useEditorStore((s) => s.complianceOpen);
  const toggleCompliance = useEditorStore((s) => s.toggleCompliance);

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-palm/40 backdrop-blur-sm lg:hidden"
          onClick={toggleCompliance}
        />
      )}
      <aside
        aria-hidden={!open}
        className={`fixed inset-y-0 right-0 z-50 flex w-[360px] max-w-[92vw] flex-col border-l border-sand-200 bg-white shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-sand-200 px-4">
          <h3 className="font-serif text-base font-semibold text-cocoa">Compliance</h3>
          <button
            type="button"
            onClick={toggleCompliance}
            aria-label="Close compliance panel"
            className="rounded-full p-1.5 text-cocoa-muted transition hover:bg-sand-100 hover:text-cocoa"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-cocoa-muted">Wired in a later task.</p>
        </div>
      </aside>
    </>
  );
}
