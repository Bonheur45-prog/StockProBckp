import mongoose from "mongoose";
import { syncablePlugin } from "./plugins/syncable.js";

const supplierSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true },
    address: { type: String, trim: true },
    notes: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

supplierSchema.plugin(syncablePlugin);

supplierSchema.index({ storeId: 1, name: 1 });

export default mongoose.model("Supplier", supplierSchema);
