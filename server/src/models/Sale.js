import mongoose from "mongoose";
import { syncablePlugin } from "./plugins/syncable.js";

const saleItemSchema = new mongoose.Schema(
  {
    // Optional: absent for a custom/ad-hoc line item that isn't tied to a
    // catalog product (e.g. a one-off cut length or negotiated service).
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: { type: String, required: true }, // snapshot at time of sale
    unitPrice: { type: Number, required: true },
    quantity: { type: Number, required: true, min: 0.001 },
    lineTotal: { type: Number, required: true },
    // What one unit COST the store at the moment of sale (snapshot of the
    // product's costPrice then) — same idea as PurchaseOrder's unitCost.
    // This is the authoritative source for the sale's margin: it is never
    // recomputed. Intentionally optional with NO default: absent on custom
    // lines (no catalog product, cost unknown) and on every sale recorded
    // before this field existed, so Profit & Loss can tell "cost was 0"
    // apart from "cost was never recorded".
    unitCost: { type: Number, min: 0 },
    isCustom: { type: Boolean, default: false },
  },
  { _id: false }
);

const saleSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    items: { type: [saleItemSchema], required: true },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    total: { type: Number, required: true },
    paymentMethod: {
      type: String,
      enum: ["cash", "mobile_money", "card", "credit"],
      default: "cash",
    },
    customerName: { type: String, trim: true },
    customerPhone: { type: String, trim: true },
    status: {
      type: String,
      enum: ["completed", "refunded", "voided"],
      default: "completed",
    },
    soldByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    // Set when the sale was actually made offline on a device, so reports
    // can distinguish "recorded late" from a backdated entry.
    occurredAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

saleSchema.plugin(syncablePlugin);

saleSchema.index({ storeId: 1, createdAt: -1 });
saleSchema.index({ storeId: 1, occurredAt: -1 });

export default mongoose.model("Sale", saleSchema);