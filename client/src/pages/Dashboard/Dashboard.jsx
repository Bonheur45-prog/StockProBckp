import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TrendingUp, DollarSign, Package, Receipt, BellRing } from "lucide-react";
import { Card, Badge, Button } from "../../components/ui/ui.jsx";
import StockGauge from "../../components/StockGauge/StockGauge.jsx";
import StatCard from "../../components/StatCard/StatCard.jsx";
import SalesChartCard from "../../components/SalesChartCard/SalesChartCard.jsx";
import { listProducts, listSales, effectiveLowStockThreshold } from "../../lib/repo.js";
import { ensureNotificationPermission, notifyLowStock } from "../../lib/notifications.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Dashboard.module.css";

export default function Dashboard() {
  const { store } = useAuth();
  const [lowStock, setLowStock] = useState([]);
  const [recentSales, setRecentSales] = useState([]);
  const [notifPermission, setNotifPermission] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );

  async function load() {
    const [products, sales] = await Promise.all([listProducts(), listSales()]);
    const low = products.filter((p) => p.quantityOnHand <= effectiveLowStockThreshold(p, store));
    setLowStock(low.slice(0, 6));
    setRecentSales(sales.slice(0, 6));
    if (notifPermission === "granted") notifyLowStock(low);
  }

  async function handleEnableNotifications() {
    const granted = await ensureNotificationPermission();
    setNotifPermission(granted ? "granted" : "denied");
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000); // reflects background sync pulls
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifPermission]);

  const currency = store?.currency || "RWF";

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Good to see you</h1>
          <p>Here's how {store?.name || "your store"} is doing.</p>
        </div>
        {notifPermission === "default" && (
          <Button variant="ghost" size="sm" onClick={handleEnableNotifications}>
            <BellRing size={14} /> Enable low-stock alerts
          </Button>
        )}
      </div>

      <div className={styles.statsGrid}>
        <StatCard title="Sales" metric="sales" icon={TrendingUp} tone="accent" initialPeriod="today" />
        <StatCard
          title="Revenue"
          metric="revenue"
          icon={DollarSign}
          tone="success"
          initialPeriod="month"
          format={(v) => `${v.toLocaleString()} ${currency}`}
        />
        <StatCard title="Items sold" metric="items" icon={Package} tone="ink" initialPeriod="year" />
      </div>

      <div className={styles.chartRow}>
        <SalesChartCard currency={currency} initialPeriod="today" />
      </div>

      <div className={styles.twoCol}>
        <Card>
          <div className={styles.cardHeader}>
            <h3>Needs restocking</h3>
            <Link to="/app/stock" className={styles.link}>Restock →</Link>
          </div>
          {lowStock.length === 0 ? (
            <p className={styles.muted}>Nothing's running low. Nicely stocked.</p>
          ) : (
            <ul className={styles.list}>
              {lowStock.map((p) => (
                <li key={p.clientId} className={styles.listRow}>
                  <span className={styles.listName}>{p.name}</span>
                  <StockGauge quantity={p.quantityOnHand} threshold={effectiveLowStockThreshold(p, store)} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className={styles.cardHeader}>
            <h3>Recent sales</h3>
            <Link to="/app/pos" className={styles.link}>New sale →</Link>
          </div>
          {recentSales.length === 0 ? (
            <p className={styles.muted}>No sales recorded yet today.</p>
          ) : (
            <ul className={styles.list}>
              {recentSales.map((s) => (
                <li key={s.clientId} className={styles.listRow}>
                  <span className={styles.listName}>
                    <Receipt size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
                    {s.items?.length} item{s.items?.length === 1 ? "" : "s"}
                    {!s.id && <Badge tone="amber">queued</Badge>}
                  </span>
                  <span className={styles.mono}>{s.total.toLocaleString()} {currency}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
