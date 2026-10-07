import crypto from "crypto";
import PriceHistory, { PRICE_FIELDS } from "../models/PriceHistory.js";

/** Normalises a price-ish value to a finite number >= 0, or null if it isn't one. */
export function toPrice(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Writes one PriceHistory row per price field that ACTUALLY changed between
 * `before` and `after` (plain objects with costPrice/sellPrice). An unrelated
 * edit (rename, category, stock) changes neither field, so writes nothing.
 *
 * kind "created": `before` is ignored and BOTH fields are recorded (oldValue null).
 * kind "change":  only fields whose numeric value differs are recorded.
 *
 * Used by the direct REST product routes. Sync-pushed edits are recorded from
 * the device's own rows instead (see syncController's priceHistory branch),
 * so the sync product branch deliberately does NOT call this — doing both
 * would log every edit twice.
 */
export async function recordPriceChanges({ storeId, product, before, after, userId, kind = "change", changedAt = new Date() }) {
  const rows = [];
  for (const field of PRICE_FIELDS) {
    const newValue = toPrice(after?.[field]) ?? 0;
    if (kind === "created") {
      rows.push({ field, oldValue: null, newValue, kind });
      continue;
    }
    const oldValue = toPrice(before?.[field]) ?? 0;
    if (oldValue !== newValue) rows.push({ field, oldValue, newValue, kind });
  }
  if (rows.length === 0) return [];

  return PriceHistory.insertMany(
    rows.map((r) => ({
      storeId,
      productId: product._id,
      productClientId: product.clientId,
      ...r,
      changedAt,
      changedBy: userId,
      clientId: crypto.randomUUID(),
    }))
  );
}

/**
 * Pure lookup: given a product's rows, what was `field` at time `at`?
 * Returns the newValue of the latest row at-or-before `at`, or null if the
 * product has no row that early (history can't answer — caller must say so).
 */
export function priceAt(rows, field, at) {
  const t = new Date(at).getTime();
  let best = null;
  for (const r of rows) {
    if (r.field !== field) continue;
    const rt = new Date(r.changedAt).getTime();
    if (rt > t) continue;
    if (!best || rt >= new Date(best.changedAt).getTime()) best = r;
  }
  return best ? best.newValue : null;
}