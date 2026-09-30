import { useEffect, useState } from "react";
import { Award, WifiOff, ShieldAlert, UserPlus, X, Ban, CheckCircle2, Users } from "lucide-react";
import { Card, Badge, Button, Field, Input, Select } from "../../components/ui/ui.jsx";
import PeriodNav from "../../components/PeriodNav/PeriodNav.jsx";
import { usePeriodNavigator } from "../../hooks/usePeriodNavigator.js";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Staff.module.css";

export default function Staff() {
  const { store, user } = useAuth();
  const nav = usePeriodNavigator("month");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(false);

  const [team, setTeam] = useState(null);
  const [teamError, setTeamError] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", password: "", role: "cashier" });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  const canView = user?.role === "owner" || user?.role === "manager";

  async function loadTeam() {
    try {
      const { data } = await api.get("/auth/users");
      setTeam(data);
      setTeamError(false);
    } catch {
      setTeamError(true);
    }
  }

  useEffect(() => {
    if (!canView) return;
    loadTeam();
  }, [canView]);

  async function handleAddTeammate(e) {
    e.preventDefault();
    setAddError("");
    if (!addForm.name || !addForm.email || !addForm.password) {
      setAddError("Name, email and password are required.");
      return;
    }
    if (addForm.password.length < 8) {
      setAddError("Password must be at least 8 characters.");
      return;
    }
    setAddSaving(true);
    try {
      await api.post("/auth/invite", addForm);
      setAddOpen(false);
      setAddForm({ name: "", email: "", password: "", role: "cashier" });
      await loadTeam();
    } catch (err) {
      setAddError(err.response?.data?.message || "Couldn't add teammate — please try again.");
    } finally {
      setAddSaving(false);
    }
  }

  async function handleToggleActive(member) {
    const verb = member.isActive ? "deactivate" : "reactivate";
    if (!confirm(`${verb === "deactivate" ? "Deactivate" : "Reactivate"} ${member.name}? ${verb === "deactivate" ? "They won't be able to log in until reactivated." : ""}`)) return;
    try {
      await api.put(`/auth/users/${member.id}`, { isActive: !member.isActive });
      await loadTeam();
    } catch (err) {
      alert(err.response?.data?.message || `Couldn't ${verb} that teammate.`);
    }
  }

  useEffect(() => {
    if (!canView) return;
    if (!navigator.onLine) {
      setError(true);
      return;
    }
    setError(false);
    setRows(null);
    api
      .get("/reports/staff-performance", {
        params: { from: nav.range.start.toISOString(), to: nav.range.end.toISOString() },
      })
      .then(({ data }) => setRows(data))
      .catch(() => setError(true));
  }, [nav.range, canView]);

  const currency = store?.currency || "RWF";
  const topRevenue = rows?.[0]?.revenue || 0;

  if (!canView) {
    return (
      <div>
        <div className={styles.header}>
          <h1>Staff performance</h1>
        </div>
        <Card>
          <p className={styles.muted}>
            <ShieldAlert size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
            Only owners and managers can view staff performance.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Staff performance</h1>
          <p className={styles.sub}>Sales, items sold, and revenue by team member. Visible to owners and managers only.</p>
        </div>
      </div>

      <Card className={styles.teamCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}><Users size={16} /> Team</span>
          <Button variant="accent" onClick={() => setAddOpen(true)}>
            <UserPlus size={15} /> Add teammate
          </Button>
        </div>

        {teamError ? (
          <p className={styles.muted}><WifiOff size={14} style={{ verticalAlign: -2, marginRight: 5 }} />Connect to the internet to manage your team.</p>
        ) : !team ? (
          <p className={styles.muted}>Loading…</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  {canView && <th />}
                </tr>
              </thead>
              <tbody>
                {team.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td className="data-table-mono">{m.email}</td>
                    <td><Badge tone="neutral">{m.role}</Badge></td>
                    <td>
                      <Badge tone={m.isActive ? "success" : "amber"}>{m.isActive ? "Active" : "Deactivated"}</Badge>
                    </td>
                    {canView && (
                      <td>
                        {m.role !== "owner" && (
                          <button className={styles.toggleBtn} onClick={() => handleToggleActive(m)}>
                            {m.isActive ? <><Ban size={14} /> Deactivate</> : <><CheckCircle2 size={14} /> Reactivate</>}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}><Award size={16} /> Performance</span>
          <PeriodNav
            rangeLabel={nav.rangeLabel}
            period={nav.period}
            onPeriodChange={nav.setPeriod}
            onBack={nav.goBack}
            onForward={nav.goForward}
            canGoForward={nav.canGoForward}
          />
        </div>

        {error ? (
          <p className={styles.muted}><WifiOff size={14} style={{ verticalAlign: -2, marginRight: 5 }} />Connect to the internet to view staff performance.</p>
        ) : !rows ? (
          <p className={styles.muted}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className={styles.muted}>No sales recorded for this period.</p>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Team member</th>
                  <th>Role</th>
                  <th data-align="right">Sales</th>
                  <th data-align="right">Items sold</th>
                  <th data-align="right">Revenue</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId || r.name}>
                    <td>{r.name}</td>
                    <td>{r.role && <Badge tone="neutral">{r.role}</Badge>}</td>
                    <td data-align="right" className="data-table-mono">{r.salesCount.toLocaleString()}</td>
                    <td data-align="right" className="data-table-mono">{r.itemsSold.toLocaleString()}</td>
                    <td data-align="right" className="data-table-mono">{r.revenue.toLocaleString()} {currency}</td>
                    <td className={styles.barCell}>
                      <div className={styles.barTrack}>
                        <div className={styles.barFill} style={{ width: `${topRevenue ? Math.round((r.revenue / topRevenue) * 100) : 0}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {addOpen && (
        <div className={styles.overlay} onClick={() => !addSaving && setAddOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Add teammate</h2>
              <button className={styles.closeBtn} onClick={() => setAddOpen(false)} disabled={addSaving}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddTeammate} className={styles.form}>
              <Field label="Name">
                <Input value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Aline Uwase" />
              </Field>
              <Field label="Email">
                <Input type="email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} placeholder="aline@example.com" />
              </Field>
              <Field label="Temporary password" hint="Share this with them — they can change it later in their own account.">
                <Input type="text" value={addForm.password} onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} placeholder="At least 8 characters" />
              </Field>
              <Field label="Role">
                <Select value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}>
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                </Select>
              </Field>

              {addError && <p className={styles.formError}>{addError}</p>}

              <div className={styles.formActions}>
                <Button type="button" variant="ghost" onClick={() => setAddOpen(false)} disabled={addSaving}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={addSaving}>{addSaving ? "Adding…" : "Add teammate"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}