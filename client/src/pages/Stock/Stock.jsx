import { useEffect, useState } from "react";
import { PackagePlus, SlidersHorizontal, X, ScanBarcode } from "lucide-react";
import { Card, Button, Field, Input, Select, Badge, EmptyState } from "../../components/ui/ui.jsx";
import StockGauge from "../../components/StockGauge/StockGauge.jsx";
import BarcodeScanner from "../../components/BarcodeScanner/BarcodeScanner.jsx";
import Pagination from "../../components/Pagination/Pagination.jsx";
import { listProducts, listMovements, restock, adjustStock, findProductByBarcode, effectiveLowStockThreshold } from "../../lib/repo.js";
import { extractBarcodeFromScan } from "../../lib/publicLink.js";
import { usePagination } from "../../hooks/usePagination.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Stock.module.css";

const MOVEMENT_LABELS = {
  restock: "Restock",
  sale: "Sale",
  adjustment: "Adjustment",
  return: "Return",
  waste: "Waste",
};

export default function Stock() {
  const { store, user } = useAuth();
  const canManageCatalog = user?.role === "owner" || user?.role === "manager";
  const [products, setProducts] = useState([]);
  const [movements, setMovements] = useState([]);
  const [modalMode, setModalMode] = useState(null); // "restock" | "adjust" | null
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanNotice, setScanNotice] = useState("");

  async function load() {
    const [p, m] = await Promise.all([listProducts(), listMovements()]);
    setProducts(p);
    setMovements(m);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  function openModal(mode) {
    if (!canManageCatalog) return;
    setModalMode(mode);
    setSelectedProductId("");
    setQuantity("");
    setReason("");
    setError("");
    setScanNotice("");
  }

  async function handleScan(code) {
    const product = await findProductByBarcode(extractBarcodeFromScan(code));
    if (product) {
      setSelectedProductId(product.clientId);
      setScanNotice(`Selected: ${product.name}`);
    } else {
      setScanNotice(`No product found for barcode ${code} — pick one manually below.`);
    }
    setScannerOpen(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canManageCatalog) return;
    setError("");
    if (!selectedProductId || !quantity) {
      setError("Choose a product and enter a quantity");
      return;
    }
    setSaving(true);
    try {
      if (modalMode === "restock") {
        await restock(selectedProductId, quantity, reason);
      } else {
        if (!reason) {
          setError("A reason is required for manual adjustments");
          setSaving(false);
          return;
        }
        await adjustStock(selectedProductId, quantity, reason);
      }
      setModalMode(null);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const productMap = new Map(products.map((p) => [p.clientId, p]));
  const movementsPage = usePagination(movements, 10);

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Stock</h1>
          <p className={styles.sub}>Every change here is logged — who, when, and why.</p>
        </div>
        <div className={styles.headerActions}>
          {canManageCatalog && (
            <>
              <Button variant="ghost" onClick={() => openModal("adjust")}><SlidersHorizontal size={16} /> Adjust</Button>
              <Button variant="accent" onClick={() => openModal("restock")}><PackagePlus size={16} /> Restock</Button>
            </>
          )}
        </div>
      </div>

      <div className={styles.levelsGrid}>
        {products.slice(0, 8).map((p) => (
          <Card key={p.clientId} className={styles.levelCard}>
            <span className={styles.levelName}>{p.name}</span>
            <StockGauge quantity={p.quantityOnHand} threshold={effectiveLowStockThreshold(p, store)} />
          </Card>
        ))}
      </div>

      <Card>
        <h3 className={styles.movementsTitle}>Recent activity</h3>
        {movements.length === 0 ? (
          <EmptyState title="No stock movements yet" description="Restocks, sales, and adjustments will show up here." />
        ) : (
          <>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Product</th>
                    <th data-align="right">Change</th>
                    <th>Reason</th>
                    <th data-align="right">When</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {movementsPage.pageItems.map((m) => {
                    const product = productMap.get(m.productId) || products.find((p) => p.id === m.productId);
                    return (
                      <tr key={m.clientId}>
                        <td><Badge tone={m.quantityChange >= 0 ? "success" : "danger"}>{MOVEMENT_LABELS[m.type] || m.type}</Badge></td>
                        <td>{product?.name || "Unknown product"}</td>
                        <td data-align="right" className="data-table-mono" style={{ color: m.quantityChange >= 0 ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                          {m.quantityChange > 0 ? "+" : ""}{m.quantityChange}
                        </td>
                        <td>{m.reason || "—"}</td>
                        <td data-align="right" className="data-table-mono">{new Date(m.createdAt).toLocaleString()}</td>
                        <td data-align="right">{!m.id && <Badge tone="amber">queued</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={movementsPage.page}
              pageCount={movementsPage.pageCount}
              onChange={movementsPage.setPage}
              totalItems={movementsPage.totalItems}
              pageSize={movementsPage.pageSize}
            />
          </>
        )}
      </Card>

      {modalMode && (
        <div className={styles.overlay} onClick={() => setModalMode(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{modalMode === "restock" ? "Restock a product" : "Adjust stock"}</h2>
              <button className={styles.iconBtn} onClick={() => setModalMode(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit} className={styles.form}>
              <Field label="Product">
                <div className={styles.productPickerRow}>
                  <Select required value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
                    <option value="">Select a product…</option>
                    {products.map((p) => (
                      <option key={p.clientId} value={p.clientId}>{p.name} ({p.quantityOnHand} on hand)</option>
                    ))}
                  </Select>
                  <button type="button" className={styles.scanBtn} onClick={() => setScannerOpen(true)} title="Scan barcode to select">
                    <ScanBarcode size={16} />
                  </button>
                </div>
                {scanNotice && <span className={styles.scanNotice}>{scanNotice}</span>}
              </Field>
              <Field label={modalMode === "restock" ? "Quantity received" : "Quantity change (use a minus for reductions, e.g. -3)"}>
                <Input type="number" required value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder={modalMode === "restock" ? "e.g. 50" : "e.g. -2"} />
              </Field>
              <Field label={modalMode === "restock" ? "Note (optional)" : "Reason"} hint={modalMode === "restock" ? "e.g. supplier name, invoice #" : "e.g. damaged, recount, theft"}>
                <Input required={modalMode === "adjust"} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              {error && <p className={styles.error}>{error}</p>}
              <div className={styles.modalActions}>
                <Button type="button" variant="ghost" onClick={() => setModalMode(null)}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving…" : "Confirm"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scannerOpen && (
        <BarcodeScanner onDetected={handleScan} onClose={() => setScannerOpen(false)} />
      )}
    </div>
  );
}