import mongoose from "mongoose";
import { syncablePlugin } from "./plugins/syncable.js";

const poItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true }, // snapshot at time of order
    quantityOrdered: { type: Number, required: true, min: 0.001 },
    quantityReceived: { type: Number, default: 0, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const purchaseOrderSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    supplierName: { type: String, trim: true }, // snapshot, survives a supplier being edited/removed
    items: { type: [poItemSchema], required: true },
    status: {
      type: String,
      enum: ["draft", "ordered", "partially_received", "received", "cancelled"],
      default: "draft",
    },
    notes: { type: String, trim: true },
    expectedDate: { type: Date },
  },
  { timestamps: true }
);

purchaseOrderSchema.plugin(syncablePlugin);

purchaseOrderSchema.index({ storeId: 1, status: 1, createdAt: -1 });

export default mongoose.model("PurchaseOrder", purchaseOrderSchema);
