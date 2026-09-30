import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Trash2, Pencil } from "lucide-react";
import { Card, Button, Badge, EmptyState } from "../../components/ui/ui.jsx";
import { listStuckRecords, discardStuckRecord } from "../../lib/sync.js";
import styles from "./SyncIssues.module.css";

const TYPE_LABELS = {
  product: "Product",
  sale: "Sale",
  stockMovement: "Stock movement",
  creditPayment: "Credit payment",
  supplier: "Supplier",
  purchaseOrder: "Purchase order",
  poReceipt: "Stock receipt",
};

/**
 * A record shows up here only once the server has actually rejected it
 * (record.syncError is set) — not just because it hasn't synced yet. The
 * normal 30s retry loop already handles "hasn't synced yet"; this page is
 * specifically for "will never sync on its own, needs a decision."
 *
 * Every record here never reached the server (no one else has seen it),
 * so acting on it is a purely local decision — no role check, unlike
 * void. See discardStuckRecord's docstring in sync.js for the full
 * reasoning on what "discard" does per record type.
 */
function summarize(record) {
  switch (record.type) {
    case "product":
      return record.name || "Unnamed product";
    case "sale":
      return `${record.customerName || "Walk-in customer"} — ${(record.total ?? 0).toLocaleString()}`;
    case "stockMovement":
      return `${record.type === "restock" ? "Restock" : "Adjustment"}${record.reason ? ` — ${record.reason}` : ""}`;
    case "supplier":
      return record.name || "Unnamed supplier";
    case "purchaseOrder":
      return record.supplierName || "Purchase order";
    case "poReceipt":
      return "Stock receipt";
    case "creditPayment":
      return `Payment — ${(record.amount ?? 0).toLocaleString()}`;
    default:
      return record.clientId;
  }
}

export default function SyncIssues() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setItems(await listStuckRecords());
    setLoading(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function handleDiscard(item) {
    if (!confirm("Discard this? It never reached the server, so nothing else is affected — this just clears it from your device.")) return;
    setBusyId(item.clientId);
    try {
      await discardStuckRecord(item.type, item.clientId);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  function handleEditRetry(sale) {
    navigate("/app/pos", { state: { reopenStuckSale: sale } });
  }

  return (
    <div>
      <div className={styles.header}>
        <h1>Couldn't sync</h1>
        <p className={styles.sub}>
          These never reached the server and the automatic retry won't fix them on its own — each one needs a decision.
        </p>
      </div>

      {loading ? null : items.length === 0 ? (
        <EmptyState title="Nothing stuck" description="Everything has synced, or is still waiting its turn — not rejected." />
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <Card key={`${item.type}-${item.clientId}`} className={styles.item}>
              <div className={styles.itemMain}>
                <AlertTriangle size={16} className={styles.icon} />
                <div>
                  <div className={styles.itemTitle}>
                    <Badge tone="neutral">{TYPE_LABELS[item.type] || item.type}</Badge>
                    <span>{summarize(item)}</span>
                  </div>
                  <p className={styles.reason}>{item.syncError}</p>
                </div>
              </div>
              <div className={styles.itemActions}>
                {item.type === "sale" && (
                  <Button variant="ghost" onClick={() => handleEditRetry(item)}>
                    <Pencil size={14} /> Edit & retry
                  </Button>
                )}
                <Button variant="ghost" onClick={() => handleDiscard(item)} disabled={busyId === item.clientId}>
                  <Trash2 size={14} /> Discard
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
