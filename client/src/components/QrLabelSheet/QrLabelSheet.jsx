import { useEffect, useState } from "react";
import { X, Printer } from "lucide-react";
import { generateQrDataUrl } from "../../lib/qr.js";
import { buildPublicProductUrl } from "../../lib/publicLink.js";
import styles from "./QrLabelSheet.module.css";

/**
 * Print-preview for one or more product QR labels. The QR now encodes the
 * public product page URL (see lib/publicLink.js) rather than a bare
 * barcode — that's what lets a customer's own camera app open something
 * useful, while the internal scanner (POS/Stock/Products/lookup) still
 * resolves it back to the same product via extractBarcodeFromScan.
 */
export default function QrLabelSheet({ products, storeSlug, onClose }) {
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const results = [];
      for (const p of products) {
        const url = buildPublicProductUrl(storeSlug, p.barcode);
        const dataUrl = await generateQrDataUrl(url);
        results.push({ clientId: p.clientId, name: p.name, dataUrl });
      }
      if (!cancelled) {
        setLabels(results);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [products, storeSlug]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.headerBar}>
          <span className={styles.title}>
            {products.length} QR label{products.length !== 1 ? "s" : ""}
          </span>
          <div className={styles.headerActions}>
            <button className={styles.printBtn} onClick={() => window.print()} disabled={loading}>
              <Printer size={15} /> Print
            </button>
            <button className={styles.iconBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className={styles.loading}>Generating codes…</div>
        ) : (
          <div className={styles.sheet} id="qr-print-area">
            {labels.map((l) => (
              <div key={l.clientId} className={styles.label}>
                <img src={l.dataUrl} alt="" className={styles.qrImg} />
                <div className={styles.labelName}>{l.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}