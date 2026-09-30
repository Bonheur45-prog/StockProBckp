import mongoose from "mongoose";
import { syncablePlugin } from "./plugins/syncable.js";

/**
 * A customer buying on credit (paymentMethod "credit" on a Sale) builds up
 * a balance. This collection records payments made against that balance.
 * Balance owed = sum(credit sales for this customer) - sum(payments).
 * Customers are identified by name+phone rather than a separate Customer
 * table — simplest thing that works for a solo-run store; worth promoting
 * to a real Customer model later if stores want more than a running tab.
 */
const creditPaymentSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, trim: true, default: "" },
    amount: { type: Number, required: true, min: 0.01 },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

creditPaymentSchema.plugin(syncablePlugin);

creditPaymentSchema.index({ storeId: 1, customerName: 1, customerPhone: 1 });

export default mongoose.model("CreditPayment", creditPaymentSchema);
