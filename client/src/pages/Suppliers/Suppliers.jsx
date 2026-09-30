import { useEffect, useState } from "react";
import { Truck, Plus, X, Pencil, Trash2 } from "lucide-react";
import { Card, Button, Field, Input, EmptyState } from "../../components/ui/ui.jsx";
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from "../../lib/repo.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Suppliers.module.css";

const EMPTY_FORM = { name: "", phone: "", email: "", address: "", notes: "" };

export default function Suppliers() {
  const { user } = useAuth();
  const canEdit = user?.role === "owner" || user?.role === "manager";

  const [suppliers, setSuppliers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setSuppliers(await listSuppliers());
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
    setModalOpen(true);
  }

  function openEdit(supplier) {
    setEditingId(supplier.clientId);
    setForm({
      name: supplier.name || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      address: supplier.address || "",
      notes: supplier.notes || "",
    });
    setError("");
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Supplier name is required");
    setError("");
    setSaving(true);
    try {
      if (editingId) {
        await updateSupplier(editingId, form);
      } else {
        await createSupplier(form);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(supplier) {
    if (!confirm(`Remove "${supplier.name}" from your suppliers?`)) return;
    await deleteSupplier(supplier.clientId);
    load();
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Suppliers</h1>
          <p className={styles.sub}>Who you buy from — used when creating purchase orders.</p>
        </div>
        {canEdit && (
          <Button variant="accent" onClick={openCreate}>
            <Plus size={16} /> Add supplier
          </Button>
        )}
      </div>

      {suppliers.length === 0 ? (
        <Card>
          <EmptyState
            title="No suppliers yet"
            description="Add a supplier so you can create purchase orders against them."
            action={canEdit ? <Button variant="accent" onClick={openCreate}><Plus size={16} /> Add supplier</Button> : undefined}
          />
        </Card>
      ) : (
        <div className={styles.grid}>
          {suppliers.map((s) => (
            <Card key={s.clientId} className={styles.card}>
              <div className={styles.cardTop}>
                <div className={styles.iconWrap}><Truck size={16} /></div>
                <div className={styles.info}>
                  <div className={styles.name}>{s.name}</div>
                  {s.phone && <div className={styles.meta}>{s.phone}</div>}
                  {s.email && <div className={styles.meta}>{s.email}</div>}
                </div>
                {canEdit && (
                  <div className={styles.actions}>
                    <button className={styles.iconBtn} onClick={() => openEdit(s)} title="Edit"><Pencil size={14} /></button>
                    <button className={styles.iconBtn} onClick={() => handleDelete(s)} title="Remove"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>
              {s.address && <p className={styles.address}>{s.address}</p>}
              {s.notes && <p className={styles.notes}>{s.notes}</p>}
            </Card>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className={styles.overlay} onClick={() => setModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingId ? "Edit supplier" : "Add supplier"}</h2>
              <button className={styles.iconBtn} onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className={styles.form}>
              <Field label="Name">
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <div className={styles.row2}>
                <Field label="Phone">
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </Field>
                <Field label="Email">
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </Field>
              </div>
              <Field label="Address">
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <Field label="Notes">
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. payment terms, delivery days" />
              </Field>
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.modalActions}>
                <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving…" : "Save supplier"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
