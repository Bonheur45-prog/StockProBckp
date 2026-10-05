import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Ban, CheckCircle2 } from "lucide-react";
import { Card, Badge, Button, Field, Select, Input } from "../../components/ui/ui.jsx";
import { api } from "../../lib/api.js";
import { storeStatus } from "../../lib/storeStatus.js";
import styles from "./Admin.module.css";

export default function AdminStoreDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState("free");
  const [trialEndsAt, setTrialEndsAt] = useState("");

  async function load() {
    try {
      const { data } = await api.get(`/admin/stores/${id}`);
      setData(data);
      setPlan(data.store.plan);
      setTrialEndsAt(data.store.trialEndsAt ? data.store.trialEndsAt.slice(0, 10) : "");
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.put(`/admin/stores/${id}`, { plan, trialEndsAt: trialEndsAt || null });
      await load();
    } catch (err) {
      alert(err.response?.data?.message || "Couldn't save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleSuspend() {
    const suspending = data.store.isActive;
    if (!confirm(suspending ? `Suspend ${data.store.name}? They won't be able to log in until reactivated.` : `Reactivate ${data.store.name}?`)) return;
    setSaving(true);
    try {
      await api.put(`/admin/stores/${id}`, { isActive: !data.store.isActive });
      await load();
    } catch (err) {
      alert(err.response?.data?.message || "Couldn't update store status.");
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className={styles.muted}>Couldn't load that store.</p>;
  if (!data) return <p className={styles.muted}>Loading…</p>;

  const { store, team, productCount } = data;

  return (
    <div>
      <Link to="/admin/stores" className={styles.backLink}><ArrowLeft size={14} /> All stores</Link>

      <div className={styles.detailHeader}>
        <div>
          <h1 className={styles.pageTitle}>{store.name}</h1>
          <p className={styles.muted}>{store.businessType || "Business type not set"} · {productCount} products · {team.length} users</p>
        </div>
        <Badge tone={storeStatus(store).tone}>{storeStatus(store).label}</Badge>
      </div>

      <div className={styles.twoCol}>
        <Card>
          <h3 className={styles.cardTitle}>Profile</h3>
          <DetailRow label="Address" value={store.address || "—"} />
          <DetailRow label="Phone" value={store.phone || "—"} />
          <DetailRow label="TIN" value={store.tin || "—"} />
          <DetailRow label="Currency" value={store.currency} />
          <DetailRow label="SKU prefix" value={store.skuPrefix || "—"} />
          <DetailRow label="Signed up" value={new Date(store.createdAt).toLocaleDateString()} />
        </Card>

        <Card>
          <h3 className={styles.cardTitle}>Admin controls</h3>
          <Field label="Plan">
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="premium">Premium</option>
            </Select>
          </Field>
          <Field label="Trial ends" hint="Leave blank to clear the trial countdown entirely">
            <Input type="date" value={trialEndsAt} onChange={(e) => setTrialEndsAt(e.target.value)} />
          </Field>
          <Button variant="accent" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>

          <div className={styles.dangerZone}>
            <Button variant="ghost" onClick={handleToggleSuspend} disabled={saving}>
              {store.isActive ? <><Ban size={15} /> Suspend store</> : <><CheckCircle2 size={15} /> Reactivate store</>}
            </Button>
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 16 }}>
        <h3 className={styles.cardTitle}>Team</h3>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr>
            </thead>
            <tbody>
              {team.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="data-table-mono">{u.email}</td>
                  <td><Badge tone="neutral">{u.role}</Badge></td>
                  <td><Badge tone={u.isActive ? "success" : "amber"}>{u.isActive ? "Active" : "Deactivated"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.muted}>{label}</span>
      <span>{value}</span>
    </div>
  );
}