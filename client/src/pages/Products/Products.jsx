import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Search, Pencil, Trash2, ImagePlus, X, Download, Upload, ScanBarcode, Wand2, QrCode } from "lucide-react";
import { Card, Button, Field, Input, Select, Badge, EmptyState } from "../../components/ui/ui.jsx";
import StockGauge from "../../components/StockGauge/StockGauge.jsx";
import CategorySelect from "../../components/CategorySelect/CategorySelect.jsx";
import PhotoDropzone from "../../components/PhotoDropzone/PhotoDropzone.jsx";
import BarcodeScanner from "../../components/BarcodeScanner/BarcodeScanner.jsx";
import QrLabelSheet from "../../components/QrLabelSheet/QrLabelSheet.jsx";
import { listProducts, countProducts, createProduct, updateProduct, deleteProduct, restock, effectiveLowStockThreshold } from "../../lib/repo.js";
import { generateSku, deriveSkuPrefix } from "../../lib/skuGen.js";
import { extractBarcodeFromScan } from "../../lib/publicLink.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { usePagination } from "../../hooks/usePagination.js";
import Pagination from "../../components/Pagination/Pagination.jsx";
import ProductsTable from "../../components/ProductsTable/ProductsTable.jsx";
import { api } from "../../lib/api.js";
import { downloadCsv, parseCsv } from "../../lib/csv.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Products.module.css";

const EMPTY_FORM = {
  name: "", sku: "", barcode: "", category: "", unit: "pcs",
  costPrice: "", sellPrice: "", quantityOnHand: "", lowStockThreshold: "", imageUrl: "", isActive: true,
};

export default function Products() {
  const { store, user } = useAuth();
  const canManageCatalog = user?.role === "owner" || user?.role === "manager";
  const location = useLocation();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [catalogCount, setCatalogCount] = useState(null); // null until the first load, so we never flash "No products yet"
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [qrSheetProducts, setQrSheetProducts] = useState(null);
  const [error, setError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [searchScannerOpen, setSearchScannerOpen] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [importPreview, setImportPreview] = useState(null); // { toCreate, toRestock, skipped }
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  // Manage the blob URL for a locally-selected (not yet uploaded) photo
  // ourselves, so we revoke it on change/unmount instead of leaking a new
  // object URL on every render.
  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Arriving here from POS after scanning a barcode with no match — open
  // the create form pre-filled so the next scan of the same item works.
  useEffect(() => {
    if (location.state?.prefillBarcode) {
      setEditingId(null);
      setForm({ ...EMPTY_FORM, barcode: location.state.prefillBarcode });
      setImageFile(null);
      setError("");
      setModalOpen(true);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  async function load() {
    const [items, total] = await Promise.all([listProducts({ search, lowStockOnly }), countProducts()]);
    setProducts(items);
    setCatalogCount(total);
  }

  useEffect(() => {
    load();
  }, [search, lowStockOnly]);

  useEffect(() => {
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [search, lowStockOnly]);

  function openCreate() {
    if (!canManageCatalog) return;
    setEditingId(null);
    setForm(EMPTY_FORM);
    setImageFile(null);
    setError("");
    setModalOpen(true);
  }

  function openEdit(product) {
    if (!canManageCatalog) return;
    setEditingId(product.clientId);
    setForm({
      name: product.name || "",
      sku: product.sku || "",
      barcode: product.barcode || "",
      category: product.category || "",
      unit: product.unit || "pcs",
      costPrice: product.costPrice ?? "",
      sellPrice: product.sellPrice ?? "",
      quantityOnHand: product.quantityOnHand ?? "",
      lowStockThreshold: product.lowStockThreshold ?? "",
      imageUrl: product.imageUrl || "",
      isActive: product.isActive !== false,
    });
    setImageFile(null);
    setError("");
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    if (!form.name || form.sellPrice === "") {
      setError("Name and sell price are required");
      return;
    }
    setSaving(true);
    try {
      let imageUrl = form.imageUrl;
      if (imageFile) {
        if (!navigator.onLine) {
          setError("Photo uploads need a connection — saved without it for now, you can add it later.");
        } else {
          setUploading(true);
          const fd = new FormData();
          fd.append("image", imageFile);
          const { data } = await api.post("/sync/upload-queued-image", fd, { headers: { "Content-Type": "multipart/form-data" } });
          imageUrl = data.imageUrl;
          setUploading(false);
        }
      }

      const payload = { ...form, imageUrl };
      if (editingId) {
        await updateProduct(editingId, payload);
      } else {
        await createProduct(payload);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      setError(err.message || "Couldn't save product");
    } finally {
      setSaving(false);
      setUploading(false);
    }
  }

  async function handleDelete(product) {
    if (!canManageCatalog) return;
    if (!confirm(`Remove "${product.name}" from your catalog?`)) return;
    await deleteProduct(product.clientId);
    load();
  }

  function handleExport() {
    downloadCsv(
      "products.csv",
      products.map((p) => ({
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        category: p.category,
        unit: p.unit,
        costPrice: p.costPrice,
        sellPrice: p.sellPrice,
        quantityOnHand: p.quantityOnHand,
        lowStockThreshold: p.lowStockThreshold ?? "",
      }))
    );
  }

  function toggleSelect(clientId, checked) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(clientId);
      else next.delete(clientId);
      return next;
    });
  }

  function toggleSelectAll(pageProducts, checked) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of pageProducts) {
        if (checked) next.add(p.clientId);
        else next.delete(p.clientId);
      }
      return next;
    });
  }

  /** Filters out products with no barcode (nothing for the QR to encode)
   * and tells the user which ones were skipped, rather than silently
   * printing a blank label or crashing. */
  function openQrSheet(candidates) {
    const printable = candidates.filter((p) => p.barcode);
    const skipped = candidates.length - printable.length;
    if (printable.length === 0) {
      alert("No barcode to encode yet — run \"Generate missing codes\" first.");
      return;
    }
    if (skipped > 0) {
      alert(`${skipped} product(s) skipped — no barcode yet. Run "Generate missing codes" first for those.`);
    }
    setQrSheetProducts(printable);
  }

  function handlePrintQr(product) {
    openQrSheet([product]);
  }

  function handleBulkPrintQr() {
    const selected = products.filter((p) => selectedIds.has(p.clientId));
    openQrSheet(selected);
  }


   /* (the product's own clientId) for every product missing one. Runs
   * sequentially and keeps a growing "working" copy of the list so two
   * products in the same batch that need the same category prefix don't
   * both land on the same sequence number. */
  
  async function handleBackfillCodes() {
    const skuPrefix = store?.skuPrefix || deriveSkuPrefix(store?.name || "");
    const missing = products.filter((p) => !p.sku || !p.barcode);
    if (missing.length === 0) {
      alert("Every product already has a SKU and a barcode.");
      return;
    }
    if (!confirm(`Generate a SKU and/or barcode for ${missing.length} product(s)?`)) return;

    setBackfilling(true);
    let working = [...products];
    let count = 0;
    try {
      for (const product of missing) {
        const changes = {};
        if (!product.sku) {
          changes.sku = generateSku({ skuPrefix, category: product.category, existingProducts: working });
        }
        if (!product.barcode) {
          changes.barcode = product.clientId;
        }
        await updateProduct(product.clientId, changes);
        working = working.map((p) => (p.clientId === product.clientId ? { ...p, ...changes } : p));
        count += 1;
      }
      await load();
      alert(`Generated codes for ${count} product(s).`);
    } catch (err) {
      alert(err.message || "Something went wrong generating codes.");
    } finally {
      setBackfilling(false);
    }
  }

  /** Matches an imported row to an existing product by name, SKU, or barcode — any one match counts. */
  function findExistingMatch(row) {
    const name = (row.name || "").trim().toLowerCase();
    const sku = (row.sku || "").trim().toLowerCase();
    const barcode = (row.barcode || "").trim().toLowerCase();
    return products.find((p) => {
      const pSku = (p.sku || "").trim().toLowerCase();
      const pBarcode = (p.barcode || "").trim().toLowerCase();
      const pName = (p.name || "").trim().toLowerCase();
      return (sku && pSku && pSku === sku) || (barcode && pBarcode && pBarcode === barcode) || (name && pName && pName === name);
    });
  }

  function handleImportFileSelected(e) {
    if (!canManageCatalog) return;
    const file = e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result));
      const toCreate = [];
      const toRestock = [];
      const skipped = [];

      for (const row of rows) {
        const match = findExistingMatch(row);
        if (match) {
          const quantity = Number(row.quantityOnHand);
          if (!quantity || quantity <= 0) {
            skipped.push({ row, reason: "matched an existing product but had no quantity to add" });
            continue;
          }
          toRestock.push({ product: match, quantity, row });
        } else {
          if (!row.name || row.sellPrice === undefined || row.sellPrice === "") {
            skipped.push({ row, reason: "missing name or sell price" });
            continue;
          }
          toCreate.push(row);
        }
      }

      setImportPreview({ toCreate, toRestock, skipped });
    };
    reader.readAsText(file);
  }

  async function confirmImport() {
    if (!importPreview) return;
    setImporting(true);
    try {
      for (const row of importPreview.toCreate) {
        await createProduct({
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          category: row.category,
          unit: row.unit || "pcs",
          costPrice: row.costPrice,
          sellPrice: row.sellPrice,
          quantityOnHand: row.quantityOnHand,
          lowStockThreshold: row.lowStockThreshold,
        });
      }
      for (const { product, quantity } of importPreview.toRestock) {
        await restock(product.clientId, quantity, "CSV import");
      }
      setImportPreview(null);
      load();
    } finally {
      setImporting(false);
    }
  }

  const currency = store?.currency || "RWF";
  const isMobile = useIsMobile();
  const { page, setPage, pageCount, pageItems, totalItems, pageSize } = usePagination(products, 12);

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Products</h1>
          <p className={styles.sub}>
            {catalogCount ?? 0} in your catalog
            {(search || lowStockOnly) && catalogCount !== null && ` · ${products.length} match${products.length === 1 ? "" : "es"}`}
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="ghost" onClick={handleExport} disabled={products.length === 0}>
            <Download size={16} /> Export CSV
          </Button>
          {canManageCatalog && (
            <>
              <Button variant="ghost" onClick={handleBackfillCodes} disabled={backfilling}>
                <Wand2 size={16} /> Generate missing codes
              </Button>
              <Button variant="ghost" onClick={() => fileInputRef.current?.click()}>
                <Upload size={16} /> Import CSV
              </Button>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleImportFileSelected} />
              <Button variant="accent" onClick={openCreate}>
                <Plus size={16} /> Add product
              </Button>
            </>
          )}
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input className={styles.searchInput} placeholder="Search by name, SKU, or barcode" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className={styles.toolbarScanBtn} onClick={() => setSearchScannerOpen(true)} title="Scan a barcode to find a product">
          <ScanBarcode size={16} />
        </button>
        <label className={styles.checkboxLabel}>
          <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>

      {!isMobile && canManageCatalog && selectedIds.size > 0 && (
        <div className={styles.selectionBar}>
          <span>{selectedIds.size} selected</span>
          <div className={styles.selectionActions}>
            <button className={styles.selectionClearBtn} onClick={() => setSelectedIds(new Set())}>Clear</button>
            <Button variant="accent" onClick={handleBulkPrintQr}>
              <QrCode size={15} /> Print QR labels
            </Button>
          </div>
        </div>
      )}

      {products.length === 0 ? (
        catalogCount === null ? null : catalogCount === 0 ? (
          <Card>
            <EmptyState
              title="No products yet"
              description="Add your first product to start tracking stock and taking sales."
              action={canManageCatalog ? <Button variant="accent" onClick={openCreate}><Plus size={16} /> Add product</Button> : null}
            />
          </Card>
        ) : (
          // The catalog has products — the search or filter just matched none of them.
          <Card>
            <EmptyState
              title={search ? `No products match “${search}”` : "No low-stock products"}
              description={
                search
                  ? "Check the spelling, or search by SKU or barcode instead. Products you've removed no longer appear here."
                  : "Nothing in your catalog is at or below its low-stock level right now."
              }
              action={<Button variant="ghost" onClick={() => { setSearch(""); setLowStockOnly(false); }}>Clear {search ? "search" : "filter"}</Button>}
            />
          </Card>
        )
      ) : isMobile ? (
        <div className={styles.grid}>
          {pageItems.map((p) => (
            <Card key={p.clientId} className={styles.productCard}>
              <div className={styles.thumb}>
                {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <ImagePlus size={22} color="#c3cad4" />}
              </div>
              <div className={styles.productInfo}>
                <div className={styles.productTop}>
                  <span className={styles.productName}>{p.name}</span>
                  {!p.id && <Badge tone="amber">queued</Badge>}
                  {p.isActive === false && <Badge tone="neutral">inactive</Badge>}
                </div>
                <div className={styles.productMeta}>{p.sku || "no SKU"} · {p.category || "Uncategorized"}</div>
                <div className={styles.productRow}>
                  <span className={styles.price}>{p.sellPrice?.toLocaleString()} {currency}</span>
                  <StockGauge quantity={p.quantityOnHand} threshold={effectiveLowStockThreshold(p, store)} />
                </div>
              </div>
              <div className={styles.actions}>
                {canManageCatalog && (
                  <>
                    <button className={styles.iconBtn} onClick={() => openEdit(p)} title="Edit"><Pencil size={15} /></button>
                    <button className={styles.iconBtn} onClick={() => handleDelete(p)} title="Remove"><Trash2 size={15} /></button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <ProductsTable
          products={pageItems}
          canManageCatalog={canManageCatalog}
          currency={currency}
          onEdit={openEdit}
          onDelete={handleDelete}
          onPrintQr={handlePrintQr}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
        />
      )}

      <Pagination page={page} pageCount={pageCount} onChange={setPage} totalItems={totalItems} pageSize={pageSize} />

      {modalOpen && (
        <div className={styles.overlay} onClick={() => setModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingId ? "Edit product" : "Add product"}</h2>
              <button className={styles.iconBtn} onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className={styles.form}>
              <Field label="Photo">
                <PhotoDropzone
                  previewSrc={imagePreviewUrl || form.imageUrl || null}
                  onFileSelected={setImageFile}
                />
              </Field>

              <div className={styles.row2}>
                <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Claw Hammer 16oz" /></Field>
                <Field label="Category">
                  <CategorySelect value={form.category} onChange={(val) => setForm({ ...form, category: val })} />
                </Field>
              </div>

              <div className={styles.row2}>
                <Field label="SKU"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
                <Field label="Barcode">
                  <div className={styles.barcodeRow}>
                    <Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
                    <button type="button" className={styles.scanBtn} onClick={() => setScannerOpen(true)} title="Scan barcode">
                      <ScanBarcode size={16} />
                    </button>
                  </div>
                </Field>
              </div>

              <div className={styles.row3}>
                <Field label="Cost price"><Input type="number" min="0" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} /></Field>
                <Field label="Sell price"><Input type="number" min="0" step="0.01" required value={form.sellPrice} onChange={(e) => setForm({ ...form, sellPrice: e.target.value })} /></Field>
                <Field label="Unit">
                  <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                    {["pcs", "box", "kg", "m", "l", "roll", "bag"].map((u) => <option key={u} value={u}>{u}</option>)}
                  </Select>
                </Field>
              </div>

              <div className={styles.row2}>
                <Field label={editingId ? "Quantity on hand" : "Starting quantity"} hint={editingId ? "Use Stock → Adjust to change this instead" : undefined}>
                  <Input type="number" min="0" disabled={!!editingId} value={form.quantityOnHand} onChange={(e) => setForm({ ...form, quantityOnHand: e.target.value })} />
                </Field>
                <Field label="Low stock alert at" hint={`Defaults to your store setting (${store?.lowStockThresholdDefault ?? 5}) if left blank`}>
                  <Input type="number" min="0" value={form.lowStockThreshold} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value })} />
                </Field>
              </div>

              {editingId && (
                <label className={styles.checkboxLabel}>
                  <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                  Active — visible and sellable in Sell. Unchecking keeps it in your catalog (unlike Remove) but hides it from checkout and barcode scanning.
                </label>
              )}

              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.modalActions}>
                <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={saving}>
                  {uploading ? "Uploading photo…" : saving ? "Saving…" : "Save product"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scannerOpen && (
        <BarcodeScanner
          onDetected={(code) => {
            setForm((f) => ({ ...f, barcode: extractBarcodeFromScan(code) }));
            setScannerOpen(false);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}

      {searchScannerOpen && (
        <BarcodeScanner
          onDetected={(code) => {
            setSearch(extractBarcodeFromScan(code));
            setSearchScannerOpen(false);
          }}
          onClose={() => setSearchScannerOpen(false)}
        />
      )}

      {qrSheetProducts && (
        <QrLabelSheet
          products={qrSheetProducts}
          storeSlug={store?.slug}
          onClose={() => {
            setQrSheetProducts(null);
            setSelectedIds(new Set());
          }}
        />
      )}

      {importPreview && (
        <div className={styles.overlay} onClick={() => !importing && setImportPreview(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Import preview</h2>
              <button className={styles.iconBtn} onClick={() => setImportPreview(null)} disabled={importing}><X size={18} /></button>
            </div>
            <div className={styles.form}>
              <p className={styles.importSummary}>
                <strong>{importPreview.toCreate.length}</strong> new product{importPreview.toCreate.length === 1 ? "" : "s"} will be added,{" "}
                <strong>{importPreview.toRestock.length}</strong> existing product{importPreview.toRestock.length === 1 ? "" : "s"} will be restocked
                {importPreview.skipped.length > 0 && <> — <strong>{importPreview.skipped.length}</strong> row{importPreview.skipped.length === 1 ? "" : "s"} skipped</>}.
              </p>

              {importPreview.toRestock.length > 0 && (
                <div className={styles.importSection}>
                  <h4>Restocking (matched by name, SKU, or barcode)</h4>
                  <ul className={styles.importList}>
                    {importPreview.toRestock.slice(0, 12).map((r, i) => (
                      <li key={i}>{r.product.name} <span className={styles.importQty}>+{r.quantity}</span></li>
                    ))}
                    {importPreview.toRestock.length > 12 && <li className={styles.importMore}>+{importPreview.toRestock.length - 12} more</li>}
                  </ul>
                </div>
              )}

              {importPreview.toCreate.length > 0 && (
                <div className={styles.importSection}>
                  <h4>New products</h4>
                  <ul className={styles.importList}>
                    {importPreview.toCreate.slice(0, 12).map((r, i) => (
                      <li key={i}>{r.name} <span className={styles.importQty}>{r.quantityOnHand || 0} {r.unit || "pcs"}</span></li>
                    ))}
                    {importPreview.toCreate.length > 12 && <li className={styles.importMore}>+{importPreview.toCreate.length - 12} more</li>}
                  </ul>
                </div>
              )}

              {importPreview.skipped.length > 0 && (
                <div className={styles.importSection}>
                  <h4>Skipped</h4>
                  <ul className={styles.importList}>
                    {importPreview.skipped.slice(0, 8).map((s, i) => (
                      <li key={i} className={styles.importSkipped}>{s.row.name || "(unnamed row)"} — {s.reason}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={styles.modalActions}>
                <Button type="button" variant="ghost" onClick={() => setImportPreview(null)} disabled={importing}>Cancel</Button>
                <Button
                  type="button"
                  variant="accent"
                  onClick={confirmImport}
                  disabled={importing || (importPreview.toCreate.length === 0 && importPreview.toRestock.length === 0)}
                >
                  {importing ? "Importing…" : "Confirm import"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}