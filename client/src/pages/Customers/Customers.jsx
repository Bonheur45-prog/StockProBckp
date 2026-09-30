import { useEffect, useState } from "react";
import { Users, Plus, X } from "lucide-react";
import { Card, Button, Field, Input, Badge, EmptyState } from "../../components/ui/ui.jsx";
import { listCustomerBalances, recordCreditPayment } from "../../lib/repo.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Customers.module.css";

export default function Customers() {
  const { store } = useAuth();
  const [balances, setBalances] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill, setPrefill] = useState(null);
  const [form, setForm] = useState({ customerName: "", customerPhone: "", amount: "", note: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setBalances(await listCustomerBalances());
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  function openPayment(customer) {
    setPrefill(customer);
    setForm({ customerName: customer?.customerName || "", customerPhone: customer?.customerPhone || "", amount: "", note: "" });
    setError("");
    setModalOpen(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await recordCreditPayment(form);
      setModalOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const currency = store?.currency || "RWF";
  const totalOwed = balances.reduce((sum, b) => sum + Math.max(0, b.balance), 0);

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Customers</h1>
          <p className={styles.sub}>Credit accounts — {totalOwed.toLocaleString()} {currency} outstanding across {balances.filter((b) => b.balance > 0).length} customer{balances.filter((b) => b.balance > 0).length === 1 ? "" : "s"}.</p>
        </div>
        <Button variant="accent" onClick={() => openPayment(null)}>
          <Plus size={16} /> Record payment
        </Button>
      </div>

      {balances.length === 0 ? (
        <Card>
          <EmptyState
            title="No credit customers yet"
            description="When you sell with 'Credit (pay later)' as the payment method, customers will show up here with a running balance."
          />
        </Card>
      ) : (
        <Card>
          <div className={styles.table}>
            {balances.map((b) => (
              <div key={`${b.customerName}|${b.customerPhone}`} className={styles.row}>
                <div className={styles.customerCol}>
                  <Users size={14} />
                  <div>
                    <div className={styles.name}>{b.customerName}</div>
                    {b.customerPhone && <div className={styles.phone}>{b.customerPhone}</div>}
                  </div>
                </div>
                <div className={styles.mono}>Charged {b.charged.toLocaleString()} {currency}</div>
                <div className={styles.mono}>Paid {b.paid.toLocaleString()} {currency}</div>
                <Badge tone={b.balance > 0 ? "danger" : b.balance < 0 ? "amber" : "success"}>
                  {b.balance > 0
                    ? `Owes ${b.balance.toLocaleString()} ${currency}`
                    : b.balance < 0
                    ? `Credit ${Math.abs(b.balance).toLocaleString()} ${currency}`
                    : "Settled"}
                </Badge>
                <Button variant="ghost" size="sm" onClick={() => openPayment(b)}>Record payment</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {modalOpen && (
        <div className={styles.overlay} onClick={() => setModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Record a payment</h2>
              <button className={styles.iconBtn} onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className={styles.form}>
              <Field label="Customer name">
                <Input required disabled={!!prefill} value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
              </Field>
              <Field label="Phone (optional)">
                <Input disabled={!!prefill} value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
              </Field>
              <Field label={`Amount paid (${currency})`}>
                <Input type="number" min="0" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label="Note (optional)">
                <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. paid via mobile money" />
              </Field>
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.modalActions}>
                <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving…" : "Record payment"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
