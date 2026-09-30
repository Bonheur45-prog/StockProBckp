import mongoose from "mongoose";

/**
 * Lightweight, append-only log of "who did what" across the store.
 * This is what powers a premium "activity feed" / accountability report
 * (e.g. "who adjusted stock on Product X, and why").
 * Not itself offline-syncable as an editable entity — it's a write-once
 * record created server-side whenever a mutation is committed.
 */
const auditLogSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true }, // e.g. "product.create", "stock.adjust", "sale.void"
    entityType: { type: String, required: true }, // "Product", "Sale", "StockMovement", "User"
    entityId: { type: mongoose.Schema.Types.ObjectId },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

auditLogSchema.index({ storeId: 1, createdAt: -1 });
auditLogSchema.index({ storeId: 1, entityType: 1, entityId: 1 });

export default mongoose.model("AuditLog", auditLogSchema);
