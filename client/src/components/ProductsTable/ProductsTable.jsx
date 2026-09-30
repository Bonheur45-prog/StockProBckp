import { Pencil, Trash2, ImagePlus, QrCode } from "lucide-react";
import StockGauge from "../StockGauge/StockGauge.jsx";
import styles from "./ProductsTable.module.css";

/**
 * Table view of the product catalog, shown at tablet/desktop widths
 * (Products.jsx swaps to this instead of the card grid above the 860px
 * breakpoint — see useIsMobile). Column order: checkbox, Image, Item,
 * SKU, Category, Cost price, Sell price, Unit, Stock, then actions.
 * Selection state lives in Products.jsx — this component just renders it.
 */
export default function ProductsTable({
  products,
  canManageCatalog,
  currency,
  onEdit,
  onDelete,
  onPrintQr,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
}) {
  const allSelected = products.length > 0 && products.every((p) => selectedIds.has(p.clientId));

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {canManageCatalog && (
              <th>
                <input type="checkbox" checked={allSelected} onChange={(e) => onToggleSelectAll(products, e.target.checked)} />
              </th>
            )}
            <th>Image</th>
            <th>Item</th>
            <th>SKU</th>
            <th>Category</th>
            <th data-align="right">Cost price</th>
            <th data-align="right">Sell price</th>
            <th>Unit</th>
            <th>Stock</th>
            {canManageCatalog && <th />}
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.clientId}>
              {canManageCatalog && (
                <td>
                  <input type="checkbox" checked={selectedIds.has(p.clientId)} onChange={(e) => onToggleSelect(p.clientId, e.target.checked)} />
                </td>
              )}
              <td>
                <div className={styles.thumb}>
                  {p.imageUrl ? <img src={p.imageUrl} alt={p.name} /> : <ImagePlus size={16} color="#c3cad4" />}
                </div>
              </td>
              <td>{p.name}</td>
              <td className="data-table-mono">{p.sku || "—"}</td>
              <td>{p.category || "Uncategorized"}</td>
              <td data-align="right" className="data-table-mono">{p.costPrice?.toLocaleString()} {currency}</td>
              <td data-align="right" className="data-table-mono">{p.sellPrice?.toLocaleString()} {currency}</td>
              <td>{p.unit || "pcs"}</td>
              <td>
                <StockGauge quantity={p.quantityOnHand} threshold={p.lowStockThreshold ?? 5} />
              </td>
              {canManageCatalog && (
                <td>
                  <div className={styles.rowActions}>
                    <button className={styles.iconBtn} onClick={() => onPrintQr(p)} title="Print QR label"><QrCode size={15} /></button>
                    <button className={styles.iconBtn} onClick={() => onEdit(p)} title="Edit"><Pencil size={15} /></button>
                    <button className={styles.iconBtn} onClick={() => onDelete(p)} title="Remove"><Trash2 size={15} /></button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}