/**
 * "BrightLink Hardware Store" -> "BHS". Mirrors authController.js's
 * deriveSkuPrefix on the server (used as the default at signup) — kept
 * here too so Settings can show the same suggestion for a store created
 * before skuPrefix existed, without a round trip to the server.
 */
export function deriveSkuPrefix(storeName) {
  const initials = (storeName || "")
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return initials.slice(0, 4) || "STR";
}

/**
 * "Auto-Mobile" -> "AUT", "Medecine" -> "MED", blank/"Uncategorized" ->
 * "GEN". Categories here are free text (there's no category table — see
 * CategorySelect.jsx), so this is a simple deterministic rule rather than
 * a per-category configured code. Two unrelated categories could in
 * theory land on the same 3-letter prefix; that's only cosmetic, since
 * the sequence number after it still keeps every SKU unique.
 */
export function deriveCategoryPrefix(category) {
  const letters = (category || "").toUpperCase().replace(/[^A-Z]/g, "");
  return letters.slice(0, 3) || "GEN";
}

/**
 * Builds the next SKU for a product, formatted
 * {skuPrefix}-{categoryPrefix}-{0001}. The sequence resets per
 * store+category-prefix combination and is derived by scanning
 * existingProducts for the highest number already used with that same
 * prefix pair — not a stored counter — so it stays correct even if
 * products were deleted or imported out of order. Guards against a
 * collision with any SKU already present (belt-and-suspenders alongside
 * the server's own uniqueness check).
 */
export function generateSku({ skuPrefix, category, existingProducts }) {
  const catPrefix = deriveCategoryPrefix(category);
  const fullPrefix = `${skuPrefix}-${catPrefix}-`;

  const usedSkus = new Set(existingProducts.map((p) => (p.sku || "").toUpperCase()));

  let maxSeq = 0;
  for (const sku of usedSkus) {
    if (sku.startsWith(fullPrefix)) {
      const n = parseInt(sku.slice(fullPrefix.length), 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }

  let next = maxSeq + 1;
  let candidate = `${fullPrefix}${String(next).padStart(4, "0")}`;
  while (usedSkus.has(candidate)) {
    next += 1;
    candidate = `${fullPrefix}${String(next).padStart(4, "0")}`;
  }
  return candidate;
}