import { useEffect, useState } from "react";
import { Card, Field, Input, Select, Button } from "../../components/ui/ui.jsx";
import AuthBackground from "../../components/AuthBackground/AuthBackground.jsx";
import { api } from "../../lib/api.js";
import { DEFAULT_AUTH_BACKGROUND } from "../../lib/authBackground.js";
import adminStyles from "./Admin.module.css";
import styles from "./AdminAppearance.module.css";

const MODE_OPTIONS = [
  { value: "default", label: "Default (dark blue)" },
  { value: "color", label: "Solid colour" },
  { value: "gradient", label: "Gradient" },
  { value: "image", label: "Image" },
  { value: "particles", label: "Moving particles (connected dots)" },
  { value: "space", label: "Deep space (moving stars)" },
];

export default function AdminAppearance() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/admin/auth-background")
      .then(({ data }) => setForm({ ...DEFAULT_AUTH_BACKGROUND, ...data }))
      .catch(() => setError("Couldn't load the current background."));
  }, []);

  function set(field, value) {
    setMessage("");
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setMessage("");
    if (file.size > 5 * 1024 * 1024) {
      setError("Image must be 5 MB or smaller.");
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("image", file);
      const { data } = await api.post("/admin/auth-background/image", body);
      setForm((f) => ({ ...f, imageUrl: data.imageUrl, mode: "image" }));
      setMessage("Image uploaded. Press Save to publish it.");
    } catch (err) {
      setError(err.response?.data?.message || "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.put("/admin/auth-background", form);
      setForm({ ...DEFAULT_AUTH_BACKGROUND, ...data });
      // Drop this browser's cached copy so the login page shows the change at once.
      try {
        localStorage.removeItem("authBackground");
      } catch {
        // ignore
      }
      setMessage("Saved. The login and create-store pages now use this background.");
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <p className={adminStyles.muted}>{error || "Loading…"}</p>;

  const usesColors = ["color", "gradient", "image", "particles", "space"].includes(form.mode);
  const usesSecondColor = ["gradient", "particles", "space"].includes(form.mode);

  return (
    <div>
      <h1 className={adminStyles.pageTitle}>Appearance</h1>
      <p className={adminStyles.muted}>Choose the background shown on the login page and the create-store page.</p>

      <div className={styles.grid}>
        <Card className={styles.controls}>
          <Field label="Background type">
            <Select value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>

          {usesColors && (
            <div className={styles.row}>
              <Field label={usesSecondColor ? "Colour 1" : form.mode === "image" ? "Fallback colour" : "Colour"}>
                <input type="color" className={styles.color} value={form.color1} onChange={(e) => set("color1", e.target.value)} />
              </Field>
              {usesSecondColor && (
                <Field label="Colour 2">
                  <input type="color" className={styles.color} value={form.color2} onChange={(e) => set("color2", e.target.value)} />
                </Field>
              )}
            </div>
          )}

          {form.mode === "image" && (
            <>
              <Field label="Background image" hint="JPG, PNG or WebP, up to 5 MB. A wide photo works best.">
                <Input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} />
              </Field>
              {uploading && <p className={adminStyles.muted}>Uploading…</p>}
              <Field label={`Darken image: ${form.overlay}%`} hint="Keeps the white text readable.">
                <input type="range" min="0" max="80" value={form.overlay} onChange={(e) => set("overlay", Number(e.target.value))} />
              </Field>
            </>
          )}

          {(form.mode === "particles" || form.mode === "space") && (
            <>
              <Field label={form.mode === "space" ? "Accent colour (nebula glow and a few stars)" : "Particle colour"}>
                <input type="color" className={styles.color} value={form.particleColor} onChange={(e) => set("particleColor", e.target.value)} />
              </Field>
              <Field label={`${form.mode === "space" ? "Stars" : "Amount"}: ${form.particleCount}`}>
                <input type="range" min="20" max="150" value={form.particleCount} onChange={(e) => set("particleCount", Number(e.target.value))} />
              </Field>
              <Field label={`Speed: ${form.particleSpeed}`}>
                <input type="range" min="1" max="5" value={form.particleSpeed} onChange={(e) => set("particleSpeed", Number(e.target.value))} />
              </Field>
            </>
          )}

          {error && <p className={styles.error}>{error}</p>}
          {message && <p className={styles.ok}>{message}</p>}
          <Button variant="accent" onClick={handleSave} disabled={saving || uploading}>
            {saving ? "Saving…" : "Save background"}
          </Button>
        </Card>

        <div className={styles.preview}>
          <AuthBackground settings={form} />
          <div className={styles.previewText}>
            <strong>StockPro</strong>
            <span>Preview</span>
          </div>
        </div>
      </div>
    </div>
  );
}
