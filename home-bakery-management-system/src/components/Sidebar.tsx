import {
  LayoutDashboard,
  ClipboardList,
  Cookie,
  Images,
  Home,
  Package,
  Users,
  Wallet,
  Tag,
  Settings,
} from "lucide-react";
import { cn } from "../utils/cn";
import type { Page } from "../App";
import { useStore } from "../context/StoreContext";

const NAV: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "products", label: "Menu & Products", icon: Cookie },
  { id: "gallery", label: "Gallery", icon: Images },
  { id: "homepage", label: "Homepage", icon: Home },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "customers", label: "Customers", icon: Users },
  { id: "payments", label: "Payments", icon: Wallet },
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
  const { profile } = useStore();
  return (
    <div className="flex h-full w-64 flex-col bg-palm text-sand-100">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-coral to-hibiscus text-white shadow-lg">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="3" fill="currentColor"/>
            <circle cx="12" cy="4.5" r="2.5" fill="currentColor" opacity="0.7"/>
            <circle cx="12" cy="19.5" r="2.5" fill="currentColor" opacity="0.7"/>
            <circle cx="4.5" cy="12" r="2.5" fill="currentColor" opacity="0.7"/>
            <circle cx="19.5" cy="12" r="2.5" fill="currentColor" opacity="0.7"/>
          </svg>
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
          return (
            <button
              key={item.id}
              onClick={() => {
                setPage(item.id);
                onNavigate?.();
              }}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-white/15 text-white shadow-inner"
                  : "text-sand-300 hover:bg-white/5 hover:text-sand-100",
              )}
            >
              <Icon size={18} className={active ? "text-coral" : ""} />
              {item.label}
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
