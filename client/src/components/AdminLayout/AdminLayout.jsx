import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { LayoutGrid, Store as StoreIcon, LifeBuoy, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./AdminLayout.module.css";

const NAV_ITEMS = [
  { to: "/admin", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/admin/stores", label: "Stores", icon: StoreIcon },
  { to: "/admin/support", label: "Support", icon: LifeBuoy },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <ShieldCheck size={20} />
          <div>
            <div className={styles.brandName}>StockPro</div>
            <div className={styles.brandSub}>Platform Admin</div>
          </div>
        </div>

        <nav className={styles.nav}>
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navItemActive : ""}`}>
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={styles.userBox}>
          <div className={styles.userName}>{user?.name}</div>
          <button className={styles.logoutBtn} onClick={handleLogout}>
            <LogOut size={15} /> Log out
          </button>
        </div>
      </aside>

      <div className={styles.content}>
        <Outlet />
      </div>
    </div>
  );
}