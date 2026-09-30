import { useEffect, useState } from "react";
import { Store, UserCircle, Database, WifiOff, CheckCircle2, Download } from "lucide-react";
import { Card, Field, Input, Button } from "../../components/ui/ui.jsx";
import PhotoDropzone from "../../components/PhotoDropzone/PhotoDropzone.jsx";
import { api } from "../../lib/api.js";
import { exportFullBackup } from "../../lib/repo.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { deriveSkuPrefix } from "../../lib/skuGen.js";
import styles from "./Settings.module.css";

function StoreProfileTab() {
  const { store, updateStore } = useAuth();
  const [form, setForm] = useState({
    name: store?.name || "",
    address: store?.address || "",
    phone: store?.phone || "",
    currency: store?.currency || "RWF",
    skuPrefix: store?.skuPrefix || deriveSkuPrefix(store?.name || ""),
    lowStockThresholdDefault: store?.lowStockThresholdDefault ?? 5,
  });
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Same object-URL lifecycle management as the product photo picker —
  // create once per file selection, revoke on change/unmount, rather than
  // leaking a new blob URL on every render.
  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaved(false);
    if (!navigator.onLine) {
      setError("Store settings need a connection to save.");
      return;
    }
    setSaving(true);
    try {
      let logoUrl, logoPublicId;
      if (logoFile) {
        setUploading(true);
        const fd = new FormData();
        fd.append("image", logoFile);
        const { data } = await api.post("/sync/upload-queued-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
        logoUrl = data.imageUrl;
        logoPublicId = data.imagePublicId;
        setUploading(false);
      }

      const payload = { ...form };
      if (logoUrl) {
        payload.logoUrl = logoUrl;
        payload.logoPublicId = logoPublicId;
      }
      const { data } = await api.put("/store", payload);
      updateStore(data);
      setLogoFile(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't save store settings.");
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className={styles.form}>
        <Field label="Store logo" hint="Shown in the sidebar, on receipts, and on PDF reports">
          <div className={styles.logoField}>
            <PhotoDropzone
              previewSrc={logoPreviewUrl || store?.logoUrl || null}
              onFileSelected={setLogoFile}
            />
          </div>
        </Field>

        <div className={styles.row2}>
          <Field label="Store name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Currency" hint="e.g. RWF, USD, KES">
            <Input required value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} maxLength={6} />
          </Field>
          <Field label="SKU prefix" hint="Used when generating SKUs, e.g. BHS-ELE-0001">
            <Input value={form.skuPrefix} onChange={(e) => setForm({ ...form, skuPrefix: e.target.value.toUpperCase() })} maxLength={4} />
          </Field>
        </div>

        <div className={styles.row2}>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Default low-stock alert" hint="Used when a product doesn't set its own threshold">
            <Input type="number" min="0" value={form.lowStockThresholdDefault} onChange={(e) => setForm({ ...form, lowStockThresholdDefault: e.target.value })} />
          </Field>
        </div>

        <Field label="Address">
          <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </Field>

        {error && (
          <p className={styles.error}>
            {!navigator.onLine && <WifiOff size={13} style={{ verticalAlign: -2, marginRight: 5 }} />}
            {error}
          </p>
        )}
        {saved && <p className={styles.success}><CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Saved.</p>}

        <div className={styles.actions}>
          <Button type="submit" variant="accent" disabled={saving}>
            {uploading ? "Uploading logo…" : saving ? "Saving…" : "Save store settings"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MyAccountTab() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSaved(false);

    if (!navigator.onLine) {
      setError("Account settings need a connection to save.");
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }

    setSaving(true);
    try {
      const payload = { name };
      if (newPassword) {
        payload.currentPassword = currentPassword;
        payload.newPassword = newPassword;
      }
      const { data } = await api.put("/auth/me", payload);
      updateUser(data.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't save account settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.row2}>
          <Field label="Name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Email" hint="Contact an owner to change your email">
            <Input value={user?.email || ""} disabled />
          </Field>
        </div>

        <div className={styles.row2}>
          <Field label="Role">
            <Input value={user?.role || ""} disabled style={{ textTransform: "capitalize" }} />
          </Field>
        </div>

        <div className={styles.divider} />

        <h3 className={styles.subheading}>Change password</h3>
        <p className={styles.hint}>Leave blank to keep your current password.</p>

        <div className={styles.row2}>
          <Field label="Current password">
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <Input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
        </div>
        <Field label="Confirm new password">
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </Field>

        {error && (
          <p className={styles.error}>
            {!navigator.onLine && <WifiOff size={13} style={{ verticalAlign: -2, marginRight: 5 }} />}
            {error}
          </p>
        )}
        {saved && <p className={styles.success}><CheckCircle2 size={13} style={{ verticalAlign: -2, marginRight: 5 }} />Saved.</p>}

        <div className={styles.actions}>
          <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving…" : "Save account settings"}</Button>
        </div>
      </form>
    </Card>
  );
}

function DataBackupTab() {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const backup = await exportFullBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `stockpro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card>
      <div className={styles.backupInfo}>
        <h3 className={styles.subheading}>Download everything</h3>
        <p className={styles.hint}>
          Exports every product, sale, stock movement, credit payment, supplier, and purchase order
          currently on this device as a single JSON file — a full backup you can keep for your own records.
          This works fully offline, since it reads straight from what's already synced to this device.
        </p>
        <div className={styles.actions}>
          <Button variant="accent" onClick={handleExport} disabled={exporting}>
            <Download size={15} /> {exporting ? "Preparing…" : "Download full backup"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
export default function Settings() {
  const { user } = useAuth();
  const canEditStore = user?.role === "owner" || user?.role === "manager";
  const [tab, setTab] = useState(canEditStore ? "store" : "account");

  return (
    <div>
      <div className={styles.header}>
        <h1>Settings</h1>
        <p className={styles.sub}>Store profile, your account, and your data.</p>
      </div>

      <div className={styles.tabs}>
        {canEditStore && (
          <button className={styles.tab} data-active={tab === "store"} onClick={() => setTab("store")}>
            <Store size={15} /> Store Profile
          </button>
        )}
        <button className={styles.tab} data-active={tab === "account"} onClick={() => setTab("account")}>
          <UserCircle size={15} /> My Account
        </button>
        <button className={styles.tab} data-active={tab === "data"} onClick={() => setTab("data")}>
          <Database size={15} /> Data & Backup
        </button>
      </div>

      {tab === "store" && canEditStore ? <StoreProfileTab /> : tab === "data" ? <DataBackupTab /> : <MyAccountTab />}
    </div>
  );
}