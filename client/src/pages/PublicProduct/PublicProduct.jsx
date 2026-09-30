import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Phone, MessageCircle, CheckCircle2, XCircle, ImageOff } from "lucide-react";
import { API_BASE_URL } from "../../lib/api.js";
import styles from "./PublicProduct.module.css";

/** Strips everything but digits, for building a wa.me link from however
 * the phone number happens to be typed in Settings (spaces, dashes, a
 * leading +, etc. all fall away). Not perfect number validation — just
 * enough to produce a working link from realistic input, and if it comes
 * out too short to plausibly be a real number, the WhatsApp button is
 * left out rather than linking somewhere broken. */
function digitsOnly(phone) {
  return (phone || "").replace(/\D/g, "");
}

export default function PublicProduct() {
  const { storeSlug, barcode } = useParams();
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    fetch(`${API_BASE_URL}/public/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(barcode)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "not_found" : "network");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setState({ loading: false, error: null, data });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: err.message || "network", data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [storeSlug, barcode]);

  if (state.loading) {
    return (
      <div className={styles.page}>
        <div className={styles.centerBox}>Loading…</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className={styles.page}>
        <div className={styles.centerBox}>
          <h2>Product not found</h2>
          <p className={styles.muted}>This code doesn't match a product we could find. It may have been removed.</p>
        </div>
        <PoweredByFooter />
      </div>
    );
  }

  const { product, store } = state.data;
  const phoneDigits = digitsOnly(store.phone);
  const showPhoneLinks = phoneDigits.length >= 9;

  return (
    <div className={styles.page}>
      <header className={styles.storeHeader}>
        {store.logoUrl ? <img src={store.logoUrl} alt={store.name} className={styles.storeLogo} /> : null}
        <span className={styles.storeName}>{store.name}</span>
      </header>

      <div className={styles.card}>
        <div className={styles.imageWrap}>
          {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <ImageOff size={32} color="#c3cad4" />}
        </div>

        <h1 className={styles.productName}>{product.name}</h1>
        {product.category && <div className={styles.category}>{product.category}</div>}

        <div className={styles.priceRow}>
          <span className={styles.price}>{product.sellPrice?.toLocaleString()} RWF</span>
          <span className={product.inStock ? styles.inStock : styles.outOfStock}>
            {product.inStock ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
            {product.inStock ? "In stock" : "Out of stock"}
          </span>
        </div>

        {showPhoneLinks && (
          <div className={styles.contactRow}>
            <a className={styles.contactBtn} href={`tel:+${phoneDigits}`}>
              <Phone size={16} /> Call
            </a>
            <a className={styles.contactBtnWhatsapp} href={`https://wa.me/${phoneDigits}`} target="_blank" rel="noreferrer">
              <MessageCircle size={16} /> WhatsApp
            </a>
          </div>
        )}
        {store.phone && <div className={styles.phoneText}>{store.phone}</div>}
      </div>

      <PoweredByFooter />
    </div>
  );
}

function PoweredByFooter() {
  return (
    <Link to="/" className={styles.poweredBy}>
      Powered by <span className={styles.poweredByBrand}>StockPro</span>
    </Link>
  );
}