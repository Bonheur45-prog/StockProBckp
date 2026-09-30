import mongoose from "mongoose";
import { syncablePlugin } from "./plugins/syncable.js";

/**
 * Every change to stock quantity — a sale, a manual restock, a correction,
 * a return — creates one of these. quantityOnHand on Product is a
 * denormalized cache for fast reads; this collection is the source of
 * truth and what powers the audit trail / "every click" tracking.
 */
const stockMovementSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    type: {
      type: String,
      enum: ["restock", "sale", "adjustment", "return", "waste"],
      required: true,
    },
    quantityChange: { type: Number, required: true }, // positive = stock in, negative = stock out
    quantityAfter: { type: Number, required: true }, // snapshot after this movement
    reason: { type: String, trim: true },
    relatedSaleId: { type: mongoose.Schema.Types.ObjectId, ref: "Sale" },
  },
  { timestamps: true }
);

stockMovementSchema.plugin(syncablePlugin);

stockMovementSchema.index({ storeId: 1, createdAt: -1 });

export default mongoose.model("StockMovement", stockMovementSchema);
