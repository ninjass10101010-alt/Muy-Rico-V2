import { useEffect, useState } from "react";
import { StoreProvider } from "./context/StoreContext";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import OrderModal from "./components/OrderModal";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import Products from "./pages/Products";
import Gallery from "./pages/Gallery";
import Homepage from "./pages/Homepage";
import Inventory from "./pages/Inventory";
import Customers from "./pages/Customers";
import Payments from "./pages/Payments";
import Receipts from "./pages/Receipts";
import LabelDesigner from "./pages/LabelDesigner";
import Settings from "./pages/Settings";
import PublicOrder from "./pages/PublicOrder";
import Quotes from "./pages/Quotes";
import CalendarView from "./pages/CalendarView";

export type Page =
  | "dashboard"
  | "orders"
  | "calendar"
  | "quotes"
  | "products"
  | "gallery"
  | "homepage"
  | "inventory"
  | "customers"
  | "payments"
  | "receipts"
  | "labels"
  | "settings";

function AdminApp() {
  const [page, setPage] = useState<Page>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [inventoryHighlightId, setInventoryHighlightId] = useState<string | null>(null);

  // Deep links: #calendar/YYYY-MM-DD → open Calendar; CalendarView consumes the
  // hash (switches to that day) and clears it once read.
  useEffect(() => {
    const m = window.location.hash.match(/^#calendar\/(\d{4}-\d{2}-\d{2})$/);
    if (m) setPage("calendar");
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-sand-50 text-cocoa">
      <div className="hidden lg:block">
        <Sidebar page={page} setPage={setPage} />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <Sidebar page={page} setPage={setPage} onNavigate={() => setMobileNavOpen(false)} />
          <div className="flex-1 bg-palm/40 backdrop-blur-sm" onClick={() => setMobileNavOpen(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          page={page}
          onMenuClick={() => setMobileNavOpen(true)}
          onNewOrder={() => setNewOrderOpen(true)}
          onOpenCalendar={() => setPage("calendar")}
          onOpenDate={(isoDate) => {
            setPage("calendar");
            window.location.hash = `calendar/${isoDate}`;
          }}
          search={search}
          setSearch={setSearch}
        />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {page === "dashboard" && <Dashboard setPage={setPage} />}
          {page === "orders" && <Orders search={search} setPage={setPage} setLabelFilter={setLabelFilter} />}
          {page === "calendar" && (
            <CalendarView
              onOpenInventory={(id) => {
                setInventoryHighlightId(id);
                setPage("inventory");
              }}
            />
          )}
          {page === "quotes" && <Quotes search={search} setPage={setPage} />}
          {page === "products" && <Products search={search} goTo={setPage} />}
          {page === "gallery" && <Gallery />}
          {page === "homepage" && <Homepage />}
          {page === "inventory" && (
            <Inventory search={search} highlightId={inventoryHighlightId} onGoToCalendar={() => setPage("calendar")} />
          )}
          {page === "customers" && <Customers search={search} />}
          {page === "payments" && <Payments search={search} />}
          {page === "receipts" && <Receipts search={search} />}
          {page === "labels" && <LabelDesigner filterByOrder={labelFilter} />}
          {page === "settings" && <Settings />}
        </main>
      </div>

      <OrderModal open={newOrderOpen} onClose={() => setNewOrderOpen(false)} />
    </div>
  );
}

function AppRouter() {
  const path = window.location.pathname;
  if (path === "/admin/order" || path === "/admin/order/") {
    return <PublicOrder />;
  }
  return <AdminApp />;
}

export default function App() {
  return (
    <StoreProvider>
      <AppRouter />
    </StoreProvider>
  );
}
