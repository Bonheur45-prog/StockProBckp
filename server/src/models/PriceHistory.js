import mongoose from "mongoose";

export const PRICE_FIELDS = ["costPrice", "sellPrice"];
export const PRICE_HISTORY_KINDS = ["created", "change", "baseline"];

/**
 * Append-only log of every cost/sell price a product has had. One row per
 * field per change — never edited, never pruned.
 *
 *  - "created":  the price the product was created with (oldValue null).
 *  - "change":   a real edit; oldValue -> newValue.
 *  - "baseline": written once by scripts/backfillPriceHistory.mjs for
 *                products that already existed when tracking was switched
 *                on (oldValue null). Everything BEFORE a baseline row is
 *                unknown — price history can only record forward.
 *
 * Deliberately NOT given the syncable plugin: it is immutable, so it has no
 * soft-delete / syncVersion / last-write-wins semantics. It still syncs
 * (pull by createdAt/updatedAt, push idempotent on clientId).
 */
const priceHistorySchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    // The product's device-generated id, kept so a device that hasn't yet
    // learned the product's server _id can still match its own rows.
    productClientId: { type: String },
    field: { type: String, enum: PRICE_FIELDS, required: true },
    oldValue: { type: Number, default: null },
    newValue: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: PRICE_HISTORY_KINDS, default: "change" },
    // When the change actually happened on the device (an offline edit may
    // sync hours later). Lookups order by this, not by createdAt.
    changedAt: { type: Date, required: true, index: true },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    clientId: { type: String, required: true },
  },
  { timestamps: true }
);

// Idempotency: replaying a sync push can never create a second row.
priceHistorySchema.index({ storeId: 1, clientId: 1 }, { unique: true });
priceHistorySchema.index({ storeId: 1, productId: 1, field: 1, changedAt: 1 });

export default mongoose.model("PriceHistory", priceHistorySchema);