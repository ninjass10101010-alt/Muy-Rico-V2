import {
  LayoutDashboard,
  ClipboardList,
  Cookie,
  Images,
  Home,
  Package,
  Users,
  Wallet,
  Mail,
  Tag,
  Settings,
  MessageSquareQuote,
} from "lucide-react";
import { cn } from "../utils/cn";
import type { Page } from "../App";
import { useStore } from "../context/StoreContext";
import muyRicoLogo from "../assets/muy_rico_logo_transparent.webp";

const NAV: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "quotes", label: "Cake Quotes", icon: MessageSquareQuote },
  { id: "products", label: "Menu & Products", icon: Cookie },
  { id: "gallery", label: "Gallery", icon: Images },
  { id: "homepage", label: "Homepage", icon: Home },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "customers", label: "Customers", icon: Users },
  { id: "payments", label: "Payments", icon: Wallet },
  { id: "receipts", label: "Receipts", icon: Mail },
  { id: "labels", label: "Label Designer", icon: Tag },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function Sidebar({
  page,
  setPage,
  onNavigate,
}: {
  page: Page;
  setPage: (p: Page) => void;
  onNavigate?: () => void;
}) {
  const { profile, quotes } = useStore();
  const pendingCount = quotes.filter((q) => q.status === "new").length;
  return (
    <div className="flex h-full w-64 flex-col bg-palm text-sand-100">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex h-10 items-center justify-center rounded-xl bg-sand-50/95 px-2 py-1 shadow-md shrink-0">
          <img
            src={muyRicoLogo}
            alt="Muy Rico"
            className="h-7 w-auto object-contain"
          />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white font-serif">{profile.name}</p>
          <p className="truncate text-xs text-sand-300">Kitchen Dashboard</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          const badge = item.id === "quotes" && pendingCount > 0 ? pendingCount : 0;
          return (
            <button
              key={item.id}
              onClick={() => {
                setPage(item.id);
                onNavigate?.();
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-white/15 text-white"
                  : "text-sand-300 hover:bg-white/5 hover:text-sand-100",
              )}
            >
              <Icon size={18} className={active ? "text-coral" : ""} />
              <span className="flex-1 text-left">{item.label}</span>
              {badge > 0 && (
                <span className="rounded-full bg-coral px-2 py-0.5 text-[10px] font-bold text-white">
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-xs text-sand-300">
        <p>Hecho con amor · Holland, MI</p>
        <p className="mt-1">Muy Rico Kitchen Dashboard</p>
      </div>
    </div>
  );
}
