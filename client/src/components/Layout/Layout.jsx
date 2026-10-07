import { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { LayoutGrid, Package, ShoppingCart, ClipboardList, BarChart3, Users, Award, Settings, Truck, ShoppingBag, Receipt, LogOut, MoreHorizontal, ScanSearch } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { runSync, pendingChangeCount } from "../../lib/sync.js";
import { findProductByBarcode } from "../../lib/repo.js";
import { extractBarcodeFromScan } from "../../lib/publicLink.js";
import SyncBadge from "../SyncBadge/SyncBadge.jsx";
import TrialBadge from "../TrialBadge/TrialBadge.jsx";
import BarcodeScanner from "../BarcodeScanner/BarcodeScanner.jsx";
import ProductLookupCard from "../ProductLookupCard/ProductLookupCard.jsx";
import styles from "./Layout.module.css";

const NAV_ITEMS = [
  { to: "/app", label: "Dashboard", icon: LayoutGrid, end: true, primary: true },
  { to: "/app/pos", label: "Sell", icon: ShoppingCart, primary: true },
  { to: "/app/products", label: "Products", icon: Package },
  { to: "/app/stock", label: "Stock", icon: ClipboardList, primary: true },
  { to: "/app/suppliers", label: "Suppliers", icon: Truck, roles: ["owner", "manager"] },
  { to: "/app/purchase-orders", label: "Purchase Orders", icon: ShoppingBag, roles: ["owner", "manager"] },
  { to: "/app/expenses", label: "Expenses", icon: Receipt, roles: ["owner", "manager"] },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/reports", label: "Reports", icon: BarChart3, primary: true },
  { to: "/app/staff", label: "Staff", icon: Award, roles: ["owner", "manager"] },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export default function Layout() {
  const { user, store, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [lookupScannerOpen, setLookupScannerOpen] = useState(false);
  const [lookup, setLookup] = useState(null); // { status: "loading"|"found"|"not-found", product }

  async function handleLogout() {
    // Logging out wipes this device's local cache (so the next person to
    // use it doesn't see a different store's data). Anything not yet
    // synced would be permanently lost in that wipe — so try to flush it
    // to the server first, and never discard unsynced work silently.
    await runSync();
    const pending = await pendingChangeCount();

    if (pending > 0) {
      const proceed = confirm(
        `${pending} change${pending === 1 ? "" : "s"} on this device ${pending === 1 ? "hasn't" : "haven't"} synced yet ` +
          `(you're likely offline). Logging out now will permanently delete ${pending === 1 ? "it" : "them"} from this device.\n\n` +
          `Log out anyway?`
      );
      if (!proceed) return;
    }

    await logout();
    navigate("/login");
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(user?.role));
  const primaryNavItems = visibleNavItems.filter((item) => item.primary);
  const secondaryNavItems = visibleNavItems.filter((item) => !item.primary);
  const isMoreActive = secondaryNavItems.some((item) => location.pathname === item.to);

  async function handleLogoutFromMore() {
    setMoreOpen(false);
    await handleLogout();
  }

  async function handleLookupScan(code) {
    setLookupScannerOpen(false);
    setLookup({ status: "loading", product: null });
    const product = await findProductByBarcode(extractBarcodeFromScan(code));
    setLookup(product ? { status: "found", product } : { status: "not-found", product: null });
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          {store?.logoUrl ? (
            <img src={store.logoUrl} alt={store.name} className={styles.brandLogo} />
          ) : (
            <span className={styles.brandMark}>SP</span>
          )}
          <div>
            <div className={styles.brandName}>StockPro</div>
            <div className={styles.storeName}>{store?.name || "Your store"}</div>
          </div>
        </div>

        <nav className={styles.nav}>
          {visibleNavItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ""}`}>
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.userBox}>
          <div className={styles.userName}>{user?.name}</div>
          <div className={styles.userRole}>{user?.role}</div>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            <LogOut size={15} /> Log out
          </button>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div>
            <TrialBadge />
          </div>
          <SyncBadge />
        </header>
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>

      <nav className={styles.bottomNav}>
        {primaryNavItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `${styles.bottomNavItem} ${isActive ? styles.bottomNavItemActive : ""}`}>
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`${styles.bottomNavItem} ${isMoreActive ? styles.bottomNavItemActive : ""}`}
          onClick={() => setMoreOpen(true)}
        >
          <MoreHorizontal size={20} />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className={styles.moreOverlay} onClick={() => setMoreOpen(false)}>
          <div className={styles.moreSheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.moreHandle} />
            <div className={styles.moreHeader}>
              <div className={styles.userName}>{user?.name}</div>
              <div className={styles.userRole}>{user?.role}</div>
            </div>
            <div className={styles.moreList}>
              <button
                className={styles.moreItem}
                onClick={() => {
                  setMoreOpen(false);
                  setLookupScannerOpen(true);
                }}
              >
                <ScanSearch size={19} />
                <span>Look up product</span>
              </button>
              {secondaryNavItems.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `${styles.moreItem} ${isActive ? styles.moreItemActive : ""}`}
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
            <button className={styles.moreLogoutBtn} onClick={handleLogoutFromMore}>
              <LogOut size={17} /> Log out
            </button>
          </div>
        </div>
      )}

      {lookupScannerOpen && <BarcodeScanner onDetected={handleLookupScan} onClose={() => setLookupScannerOpen(false)} />}

      {lookup && (
        <ProductLookupCard
          status={lookup.status}
          product={lookup.product}
          currency={store?.currency || "RWF"}
          onClose={() => setLookup(null)}
        />
      )}
    </div>
  );
}