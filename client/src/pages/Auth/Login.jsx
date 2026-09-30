import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { Card, Field, Input, Button } from "../../components/ui/ui.jsx";
import styles from "./Auth.module.css";

export default function Login() {
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", storeSlug: "" });
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      await login(form);
      navigate("/app");
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't sign in. Check your details and try again.");
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.brandSide}>
        <div className={styles.brandMark}>SP</div>
        <h1>StockPro</h1>
        <p>Stock and sales, handled — even when the signal drops.</p>
      </div>

      <Card className={styles.formCard}>
        <h2>Welcome back</h2>
        <form onSubmit={handleSubmit} className={styles.form}>
          <Field label="Email">
            <Input type="email" required value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="you@store.com" />
          </Field>
          <Field label="Password">
            <Input type="password" required value={form.password} onChange={(e) => update("password", e.target.value)} placeholder="••••••••" />
          </Field>
          <Field label="Store (only needed if your email is used at more than one store)" hint="Optional">
            <Input value={form.storeSlug} onChange={(e) => update("storeSlug", e.target.value)} placeholder="e.g. sunrise-hardware" />
          </Field>
          {error && <p className={styles.error}>{error}</p>}
          <Button type="submit" variant="accent" size="lg" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className={styles.switch}>
          New store? <Link to="/register">Set up StockPro</Link>
        </p>
      </Card>
    </div>
  );
}
