import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CloudCheck, CloudUpload, CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { onSyncStatusChange, runSync, pendingChangeCount, listStuckRecords } from "../../lib/sync.js";
import styles from "./SyncBadge.module.css";

export default function SyncBadge() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("idle");
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [stuck, setStuck] = useState([]);

  useEffect(() => {
    // The stuck-records count is read from the DB (via listStuckRecords,
    // which reads the persisted syncError field on each record), not from
    // sync.js's transient in-memory lastErrors — that in-memory list
    // resets to empty on every page load, so a badge driven by it would
    // go back to showing "pending" (not "couldn't sync") after a reload,
    // even though the actual stuck records are still sitting there
    // unresolved. Polled the same way pendingChangeCount already is,
    // plus refreshed immediately whenever a sync cycle finishes, so it
    // doesn't wait out the poll interval to reflect a just-happened
    // failure (or a just-happened Discard/retry from the recovery page).
    const refreshStuck = () => listStuckRecords().then(setStuck);
    const unsub = onSyncStatusChange((s) => {
      setStatus(s);
      refreshStuck();
    });
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    const refreshPending = () => pendingChangeCount().then(setPending);
    refreshPending();
    refreshStuck();
    const interval = setInterval(() => {
      refreshPending();
      refreshStuck();
    }, 4000);

    return () => {
      unsub();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(interval);
    };
  }, []);

  let icon = <CloudCheck size={15} />;
  let text = "Synced";
  let tone = "ok";
  let title = "Tap to sync now";

  if (!online) {
    icon = <CloudOff size={15} />;
    text = pending > 0 ? `Offline · ${pending} queued` : "Offline";
    tone = "offline";
    title = "No connection — changes are saved and will sync automatically once you're back online.";
  } else if (status === "syncing") {
    icon = <RefreshCw size={15} className={styles.spin} />;
    text = "Syncing…";
    tone = "syncing";
  } else if (stuck.length > 0) {
    // A record the server rejected stays "pending" forever until you know
    // why — so surface the actual reason here instead of a silent spinner.
    icon = <TriangleAlert size={15} />;
    text = `${stuck.length} couldn't sync`;
    tone = "error";
    title = stuck.map((r) => `${r.type}: ${r.syncError}`).join("\n") + "\n\nTap to see options.";
  } else if (pending > 0) {
    icon = <CloudUpload size={15} />;
    text = `${pending} pending`;
    tone = "pending";
  }

  return (
    <button
      className={styles.badge}
      data-tone={tone}
      onClick={() => (stuck.length > 0 ? navigate("/app/sync-issues") : runSync())}
      title={title}
    >
      {icon}
      <span>{text}</span>
    </button>
  );
}
