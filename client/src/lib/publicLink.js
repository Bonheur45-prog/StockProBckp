/**
 * Base URL for the public-facing app (the one customers land on when they
 * scan a product QR). Vite bakes VITE_PUBLIC_APP_URL in at build time — if
 * it's not set, window.location.origin is used instead, which is correct
 * for the common case (someone printing labels from the live deployed
 * app) but NOT for local dev, where it would bake in localhost. Set
 * VITE_PUBLIC_APP_URL in the client's Render environment variables to be
 * explicit and safe against that.
 */
function publicAppBaseUrl() {
  return import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin;
}

/** Builds the public product page URL — this is what actually gets
 * encoded into the printed QR now, not a bare barcode. */
export function buildPublicProductUrl(storeSlug, barcode) {
  return `${publicAppBaseUrl()}/p/${encodeURIComponent(storeSlug)}/${encodeURIComponent(barcode)}`;
}

/**
 * Given whatever a scan just decoded, returns the bare barcode to look up
 * locally. Handles three cases: a full public product URL (new labels) —
 * pulls the barcode off the end; a bare barcode (every label printed
 * before this feature existed, or a real 1D barcode) — returned as-is,
 * unchanged, so nothing already printed ever stops working; anything else
 * unrecognized — also returned as-is, since the exact-match lookup
 * already handles "not found" gracefully.
 */
export function extractBarcodeFromScan(code) {
  const trimmed = (code || "").trim();
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const pIndex = parts.indexOf("p");
    if (pIndex !== -1 && parts.length >= pIndex + 3) {
      return decodeURIComponent(parts[pIndex + 2]);
    }
  } catch {
    // Not a URL at all — that's the normal case for a bare barcode.
  }
  return trimmed;
}