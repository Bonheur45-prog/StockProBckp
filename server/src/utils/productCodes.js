import Product from "../models/Product.js";

/**
 * Two products in the same store may never share a barcode/QR value or a
 * SKU — this is the application-level check, called before every product
 * create/update so a collision gets a clean, specific error message. The
 * unique partial indexes on Product (see models/Product.js) are the
 * backstop for the rare case of two offline devices pushing a collision at
 * the same moment; that shows up as a raw MongoDB E11000 error instead,
 * which callers should catch separately (see syncController's
 * safeSyncErrorMessage for the pattern).
 *
 * excludeClientId lets an update check against every *other* product
 * without the product flagging itself as a duplicate of itself.
 */
export async function assertNoDuplicateCodes(storeId, { barcode, sku }, excludeClientId) {
  if (barcode) {
    const dupe = await Product.findOne({ storeId, barcode, clientId: { $ne: excludeClientId } });
    if (dupe) throw Object.assign(new Error(`Barcode already used by "${dupe.name}"`), { statusCode: 409 });
  }
  if (sku) {
    const dupe = await Product.findOne({ storeId, sku, clientId: { $ne: excludeClientId } });
    if (dupe) throw Object.assign(new Error(`SKU already used by "${dupe.name}"`), { statusCode: 409 });
  }
}