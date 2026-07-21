import { useState } from "react";
import { StoreProvider } from "./context/StoreContext";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import OrderModal from "./components/OrderModal";
import Dashboard from "./pages/Dashboard";
import Orders from "./pages/Orders";
import Products from "./pages/Products";
import Gallery from "./pages/Gallery";
import Inventory from "./pages/Inventory";
import Customers from "./pages/Customers";
import Payments from "./pages/Payments";
import LabelDesigner from "./pages/LabelDesigner";
import Settings from "./pages/Settings";
import PublicOrder from "./pages/PublicOrder";

export type Page =
  | "dashboard"
  | "orders"
  | "products"
  | "gallery"
  | "inventory"
  | "customers"
  | "payments"
  | "labels"
  | "settings";

function AdminApp() {
  const [page, setPage] = useState<Page>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [labelFilter, setLabelFilter] = useState<string | null>(null);

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
          search={search}
          setSearch={setSearch}
        />
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {page === "dashboard" && <Dashboard setPage={setPage} />}
          {page === "orders" && <Orders search={search} setPage={setPage} setLabelFilter={setLabelFilter} />}
          {page === "products" && <Products search={search} goTo={setPage} />}
          {page === "gallery" && <Gallery />}
          {page === "inventory" && <Inventory search={search} />}
          {page === "customers" && <Customers search={search} />}
          {page === "payments" && <Payments search={search} />}
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
