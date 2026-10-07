import mongoose from "mongoose";
import { syncablePlugin } from "./plugins/syncable.js";

export const EXPENSE_PAYMENT_METHODS = ["cash", "mobile_money", "card", "bank_transfer"];
export const EXPENSE_FREQUENCIES = ["monthly", "weekly"];

const expenseSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    // Free text, same pattern as Product.category: a category exists the
    // moment an expense uses it, there is no separate category table.
    category: { type: String, trim: true, default: "" },
    amount: { type: Number, required: true, min: 0 },
    // The day the money was actually spent (what Profit & Loss groups by),
    // not when the record was typed in. Stored as a full Date; the client
    // sends local-noon for a picked day so timezone shifts can't move it
    // into the neighbouring day.
    date: { type: Date, required: true, index: true },
    description: { type: String, trim: true, default: "" },
    paymentMethod: { type: String, enum: EXPENSE_PAYMENT_METHODS, default: "cash" },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier" },
    supplierName: { type: String, trim: true }, // snapshot, survives a supplier being edited/removed
    receiptUrl: { type: String },
    receiptPublicId: { type: String },

    // Recurring expenses (rent, salaries). A recurring "series" is every
    // expense sharing one recurringSeriesId. Nothing is ever auto-created:
    // the owner/manager triggers "Log this period's recurring expenses"
    // manually, which copies the latest entry of each active series.
    isRecurring: { type: Boolean, default: false },
    frequency: { type: String, enum: EXPENSE_FREQUENCIES, default: null },
    recurringSeriesId: { type: String, index: true },
  },
  { timestamps: true }
);

expenseSchema.plugin(syncablePlugin);

expenseSchema.index({ storeId: 1, date: -1 });

export default mongoose.model("Expense", expenseSchema);