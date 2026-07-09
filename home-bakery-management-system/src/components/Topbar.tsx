import { Menu, Plus, Search } from "lucide-react";
import type { Page } from "../App";

const TITLES: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Your bakery at a glance" },
  orders: { title: "Orders", subtitle: "Track website & in-person orders" },
  products: { title: "Menu & Products", subtitle: "Manage what you sell" },
  inventory: { title: "Inventory", subtitle: "Ingredients & supplies on hand" },
  customers: { title: "Customers", subtitle: "Your regulars & their history" },
  payments: { title: "Payments", subtitle: "Venmo, Cash App, Apple Pay & cash" },
  labels: { title: "Label Designer", subtitle: "Design & print product labels" },
  settings: { title: "Settings", subtitle: "Business profile & payment setup" },
};

export default function Topbar({
  page,
  onMenuClick,
  onNewOrder,
  search,
  setSearch,
}: {
  page: Page;
  onMenuClick: () => void;
  onNewOrder: () => void;
  search?: string;
  setSearch?: (v: string) => void;
}) {
  const meta = TITLES[page];
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-sand-200 bg-sand-50/90 px-4 py-4 backdrop-blur-sm sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-2 text-cocoa-muted hover:bg-sand-100 lg:hidden"
        >
          <Menu size={20} />
        </button>
        <div>
          <h1 className="font-serif text-lg font-semibold text-cocoa sm:text-xl">{meta.title}</h1>
          <p className="hidden text-xs text-cocoa-muted sm:block">{meta.subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {setSearch && (
          <div className="hidden items-center gap-2 rounded-xl border border-sand-200 bg-white px-3 py-2 sm:flex">
            <Search size={16} className="text-cocoa-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-40 bg-transparent text-sm text-cocoa outline-none placeholder:text-cocoa-muted"
            />
          </div>
        )}
        <button
          onClick={onNewOrder}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-mid-green to-palm px-3.5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:shadow-md sm:px-4"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">New Order</span>
        </button>
      </div>
    </div>
  );
}
