import { useState } from "react";
import { Search, KeyRound } from "lucide-react";
import { Card, Input, Badge, Button } from "../../components/ui/ui.jsx";
import { api } from "../../lib/api.js";
import styles from "./Admin.module.css";

export default function AdminSupport() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function handleSearch(e) {
    e.preventDefault();
    setError("");
    setResults(null);
    if (query.trim().length < 3) {
      setError("Enter at least 3 characters.");
      return;
    }
    setSearching(true);
    try {
      const { data } = await api.get("/admin/users", { params: { email: query.trim() } });
      setResults(data);
    } catch (err) {
      setError(err.response?.data?.message || "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  function openReset(user) {
    setResetTarget(user);
    setNewPassword("");
    setResetDone(false);
  }

  async function handleReset() {
    if (newPassword.length < 8) {
      alert("Password must be at least 8 characters.");
      return;
    }
    setResetSaving(true);
    try {
      await api.put(`/admin/users/${resetTarget.id}/reset-password`, { newPassword });
      setResetDone(true);
    } catch (err) {
      alert(err.response?.data?.message || "Couldn't reset password.");
    } finally {
      setResetSaving(false);
    }
  }

  return (
    <div>
      <h1 className={styles.pageTitle}>Support</h1>
      <p className={styles.muted} style={{ marginBottom: 16 }}>
        Find any account by email across every store — useful when someone's locked out, since there's no self-serve password reset in the app yet.
      </p>

      <form onSubmit={handleSearch} className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by email" />
        </div>
        <Button type="submit" variant="accent" disabled={searching}>{searching ? "Searching…" : "Search"}</Button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {results && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Store</th><th>Role</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {results.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="data-table-mono">{u.email}</td>
                  <td>{u.storeName || (u.isPlatformAdmin ? "— (platform admin)" : "—")}</td>
                  <td><Badge tone="neutral">{u.isPlatformAdmin ? "admin" : u.role}</Badge></td>
                  <td><Badge tone={u.isActive ? "success" : "amber"}>{u.isActive ? "Active" : "Deactivated"}</Badge></td>
                  <td>
                    <button className={styles.iconLinkBtn} onClick={() => openReset(u)}>
                      <KeyRound size={14} /> Reset password
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {results.length === 0 && <p className={styles.muted} style={{ padding: 16 }}>No matching accounts.</p>}
        </div>
      )}

      {resetTarget && (
        <div className={styles.overlay} onClick={() => setResetTarget(null)}>
          <Card className={styles.resetModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.cardTitle}>Reset password for {resetTarget.name}</h3>
            {resetDone ? (
              <>
                <p>Password updated. Share the new password with them directly.</p>
                <Button variant="accent" onClick={() => setResetTarget(null)}>Done</Button>
              </>
            ) : (
              <>
                <Input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password, at least 8 characters"
                />
                <div className={styles.modalActions}>
                  <Button variant="ghost" onClick={() => setResetTarget(null)} disabled={resetSaving}>Cancel</Button>
                  <Button variant="accent" onClick={handleReset} disabled={resetSaving}>{resetSaving ? "Saving…" : "Reset password"}</Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}