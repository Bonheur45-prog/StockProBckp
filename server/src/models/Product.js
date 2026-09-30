import mongoose from "mongoose";
import { syncablePlugin } from "./plugins/syncable.js";

const productSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    barcode: { type: String, trim: true },
    category: { type: String, trim: true, default: "" },
    unit: { type: String, default: "pcs" }, // pcs, kg, m, box, etc.
    costPrice: { type: Number, default: 0, min: 0 },
    sellPrice: { type: Number, required: true, min: 0 },
    quantityOnHand: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: null }, // falls back to store default when null
    imageUrl: { type: String },
    imagePublicId: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.plugin(syncablePlugin);

productSchema.index({ storeId: 1, name: "text", category: "text" });

// Hard uniqueness backstop: two products in the same store may never share
// a barcode/QR value or a SKU — enforced in application code first (for a
// clean, specific error message), with these as the database-level
// guarantee in case two offline devices push a collision at the same time.
// Partial so it only applies once a value is actually set — most existing
// products still have a blank barcode/sku until the backfill runs.
productSchema.index(
  { storeId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: "string", $gt: "" } } }
);
productSchema.index(
  { storeId: 1, sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: "string", $gt: "" } } }
);

export default mongoose.model("Product", productSchema);