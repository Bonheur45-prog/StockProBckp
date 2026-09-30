import { X, ImageOff, SearchX } from "lucide-react";
import StockGauge from "../StockGauge/StockGauge.jsx";
import styles from "./ProductLookupCard.module.css";

/**
 * The Phase 5 scan-to-lookup card — reachable from the More sheet on any
 * screen (see Layout.jsx). Shows everything live from the local database
 * at the moment of scanning: image, name, category, cost price, sell
 * price, current stock. Nothing here is baked into the QR code itself —
 * see the Products page discussion on why price/stock have to be looked
 * up live rather than encoded, since both change constantly.
 */
export default function ProductLookupCard({ status, product, currency, onClose }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>
          <X size={18} />
        </button>

        {status === "loading" && <div className={styles.state}>Looking up…</div>}

        {status === "not-found" && (
          <div className={styles.state}>
            <SearchX size={28} color="#c3cad4" />
            <p>No product matches that code.</p>
          </div>
        )}

        {status === "found" && product && (
          <>
            <div className={styles.imageWrap}>
              {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <ImageOff size={28} color="#c3cad4" />}
            </div>
            <h2 className={styles.name}>{product.name}</h2>
            <div className={styles.category}>{product.category || "Uncategorized"} · {product.sku || "no SKU"}</div>

            <div className={styles.priceGrid}>
              <div className={styles.priceCell}>
                <span className={styles.priceLabel}>Cost price</span>
                <span className={styles.priceValue}>{product.costPrice?.toLocaleString()} {currency}</span>
              </div>
              <div className={styles.priceCell}>
                <span className={styles.priceLabel}>Sell price</span>
                <span className={styles.priceValue}>{product.sellPrice?.toLocaleString()} {currency}</span>
              </div>
            </div>

            <div className={styles.stockRow}>
              <span className={styles.priceLabel}>Stock</span>
              <StockGauge quantity={product.quantityOnHand} threshold={product.lowStockThreshold ?? 5} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}