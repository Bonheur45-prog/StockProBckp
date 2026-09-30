import mongoose from "mongoose";

const storeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Free text, not a locked enum — the client offers a curated dropdown
    // (Hardware & Electrical, Grocery & Food, etc.) but this shouldn't
    // hard-block a business type nobody thought to list yet.
    businessType: { type: String, trim: true },
    // Rwanda Revenue Authority Tax Identification Number. Optional — plenty
    // of small/informal traders don't have one yet, and this shouldn't
    // gate signup for them.
    tin: { type: String, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    logoUrl: { type: String },
    logoPublicId: { type: String },
    currency: { type: String, default: "RWF" },
    // Used to build generated SKUs ({skuPrefix}-{categoryPrefix}-{0001}).
    // Defaulted from the store name at signup (see authController's
    // deriveSkuPrefix), editable afterward in Settings since an
    // auto-derived abbreviation isn't always the one you'd actually want.
    skuPrefix: { type: String, trim: true, uppercase: true },
    lowStockThresholdDefault: { type: Number, default: 5 },
    plan: {
      type: String,
      enum: ["free", "pro", "premium"],
      default: "free",
    },
    // Informational only for now — nothing is gated on this yet. Set once
    // at signup; a display-only countdown lives in the app UI.
    trialEndsAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("Store", storeSchema);