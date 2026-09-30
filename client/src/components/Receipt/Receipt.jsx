import { X, Printer } from "lucide-react";
import styles from "./Receipt.module.css";

/**
 * Renders a receipt and lets the user print it (browser's native print
 * dialog — works with any receipt printer set as the default printer, and
 * doubles as "save as PDF" on every OS without extra libraries).
 */
export default function Receipt({ sale, storeName, storeLogoUrl, currency, onClose }) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.headerBar}>
          <button className={styles.iconBtn} onClick={onClose}><X size={18} /></button>
          <button className={styles.printBtn} onClick={() => window.print()}>
            <Printer size={15} /> Print
          </button>
        </div>

        <div className={styles.receipt} id="receipt-print-area">
          <div className={styles.center}>
            {storeLogoUrl && <img src={storeLogoUrl} alt="" className={styles.logo} />}
            <div className={styles.storeName}>{storeName}</div>
            <div className={styles.meta}>{new Date(sale.occurredAt).toLocaleString()}</div>
            {sale.customerName && <div className={styles.meta}>Customer: {sale.customerName}</div>}
          </div>

          <div className={styles.divider} />

          <div className={styles.items}>
            {sale.items.map((item, i) => (
              <div key={i} className={styles.itemRow}>
                <span className={styles.itemName}>{item.name} × {item.quantity}</span>
                <span>{item.lineTotal.toLocaleString()}</span>
              </div>
            ))}
          </div>

          <div className={styles.divider} />

          <div className={styles.totalsRow}>
            <span>Subtotal</span>
            <span>{sale.subtotal.toLocaleString()} {currency}</span>
          </div>
          {sale.discount > 0 && (
            <div className={styles.totalsRow}>
              <span>Discount</span>
              <span>-{sale.discount.toLocaleString()} {currency}</span>
            </div>
          )}
          <div className={styles.grandTotal}>
            <span>Total</span>
            <span>{sale.total.toLocaleString()} {currency}</span>
          </div>
          <div className={styles.meta}>Paid via {sale.paymentMethod.replace("_", " ")}</div>

          <div className={styles.divider} />
          <div className={styles.center}><span className={styles.thanks}>Thank you for your business</span></div>
        </div>
      </div>
    </div>
  );
}
