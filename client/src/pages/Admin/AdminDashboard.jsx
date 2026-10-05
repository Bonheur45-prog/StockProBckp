import { useEffect, useState } from "react";
import { Store, Ban, Clock, AlertTriangle } from "lucide-react";
import { Card } from "../../components/ui/ui.jsx";
import { api } from "../../lib/api.js";
import styles from "./Admin.module.css";

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get("/admin/dashboard")
      .then(({ data }) => setData(data))
      .catch(() => setError(true));
  }, []);

  if (error) return <p className={styles.muted}>Couldn't load dashboard data.</p>;
  if (!data) return <p className={styles.muted}>Loading…</p>;

  const { totals, signupsByMonth } = data;
  const maxSignups = Math.max(1, ...signupsByMonth.map((m) => m.count));

  return (
    <div>
      <h1 className={styles.pageTitle}>Dashboard</h1>

      <div className={styles.statGrid}>
        <StatCard icon={Store} label="Total stores" value={totals.stores} />
        <StatCard icon={Clock} label="Active trials" value={totals.trialActive} />
        <StatCard icon={AlertTriangle} label="Expired trials" value={totals.trialExpired} tone="amber" />
        <StatCard icon={Ban} label="Suspended" value={totals.suspended} tone="danger" />
      </div>

      <div className={styles.twoCol}>
        <Card>
          <h3 className={styles.cardTitle}>Signups, last 6 months</h3>
          <div className={styles.barChart}>
            {signupsByMonth.map((m) => (
              <div key={m.key} className={styles.barChartCol}>
                <div className={styles.barChartBar} style={{ height: `${(m.count / maxSignups) * 100}%` }} />
                <span className={styles.barChartLabel}>{m.label}</span>
                <span className={styles.barChartValue}>{m.count}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <h3 className={styles.cardTitle}>By plan</h3>
          <BreakdownList data={totals.byPlan} />
          <h3 className={styles.cardTitle} style={{ marginTop: 18 }}>By business type</h3>
          <BreakdownList data={totals.byBusinessType} />
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }) {
  return (
    <Card className={styles.statCard}>
      <div className={`${styles.statIcon} ${tone ? styles[`statIcon_${tone}`] : ""}`}>
        <Icon size={18} />
      </div>
      <div>
        <div className={styles.statValue}>{value}</div>
        <div className={styles.statLabel}>{label}</div>
      </div>
    </Card>
  );
}

function BreakdownList({ data }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className={styles.muted}>No data yet.</p>;
  return (
    <div className={styles.breakdownList}>
      {entries.map(([key, count]) => (
        <div key={key} className={styles.breakdownRow}>
          <span>{key}</span>
          <span className={styles.breakdownCount}>{count}</span>
        </div>
      ))}
    </div>
  );
}