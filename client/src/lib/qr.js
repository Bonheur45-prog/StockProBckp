import QRCode from "qrcode";

/**
 * Generates a QR code as a data URL for a product's barcode value — the
 * exact same string already used for exact-match lookups at POS/Stock/the
 * scan-to-lookup card, nothing else encoded. See the Products page
 * discussion: price/stock change constantly and would go stale the moment
 * they're printed, so the code only carries a stable identifier and
 * everything else is looked up live at scan time.
 */
export async function generateQrDataUrl(value) {
  return QRCode.toDataURL(value, { width: 240, margin: 1 });
}