import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { Input, Badge, Select } from "../../components/ui/ui.jsx";
import { api } from "../../lib/api.js";
import { storeStatus } from "../../lib/storeStatus.js";
import styles from "./Admin.module.css";

export default function AdminStores() {
  const [stores, setStores] = useState(null);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");

  useEffect(() => {
    api
      .get("/admin/stores")
      .then(({ data }) => setStores(data))
      .catch(() => setError(true));
  }, []);

  const filtered = useMemo(() => {
    if (!stores) return [];
    const q = search.trim().toLowerCase();
    return stores.filter((s) => {
      const matchesSearch =
        !q || s.name.toLowerCase().includes(q) || s.ownerEmail.toLowerCase().includes(q) || (s.businessType || "").toLowerCase().includes(q);
      const matchesPlan = !planFilter || s.plan === planFilter;
      return matchesSearch && matchesPlan;
    });
  }, [stores, search, planFilter]);

  if (error) return <p className={styles.muted}>Couldn't load stores.</p>;

  return (
    <div>
      <h1 className={styles.pageTitle}>Stores</h1>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, owner email, or business type" />
        </div>
        <Select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
          <option value="">All plans</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="premium">Premium</option>
        </Select>
      </div>

      {!stores ? (
        <p className={styles.muted}>Loading…</p>
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Store</th>
                <th>Business type</th>
                <th>Owner</th>
                <th>Plan</th>
                <th>Status</th>
                <th data-align="right">Users</th>
                <th data-align="right">Products</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const status = storeStatus(s);
                return (
                  <tr key={s.id}>
                    <td><Link to={`/admin/stores/${s.id}`} className={styles.rowLink}>{s.name}</Link></td>
                    <td>{s.businessType || "—"}</td>
                    <td>
                      <div>{s.ownerName}</div>
                      <div className={styles.cellSub}>{s.ownerEmail}</div>
                    </td>
                    <td><Badge tone="neutral">{s.plan}</Badge></td>
                    <td><Badge tone={status.tone}>{status.label}</Badge></td>
                    <td data-align="right">{s.userCount}</td>
                    <td data-align="right">{s.productCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <p className={styles.muted} style={{ padding: 16 }}>No stores match.</p>}
        </div>
      )}
    </div>
  );
}