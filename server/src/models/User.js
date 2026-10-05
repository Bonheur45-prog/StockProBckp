import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    // Optional — only unset for a platform-admin account (see
    // isPlatformAdmin below), which isn't scoped to any one store.
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["owner", "manager", "cashier"],
      default: "cashier",
    },
    // A platform admin (BrightLink Technologies staff) manages every store
    // across the whole app — never created through public signup, only
    // via a one-off script (see server/scripts/createPlatformAdmin.mjs).
    isPlatformAdmin: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

// A given email can exist once per store (same person could theoretically
// work at two stores using this SaaS with two accounts).
userSchema.index({ storeId: 1, email: 1 }, { unique: true });

userSchema.methods.comparePassword = function (plainText) {
  return bcrypt.compare(plainText, this.passwordHash);
};

userSchema.statics.hashPassword = function (plainText) {
  return bcrypt.hash(plainText, 10);
};

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    storeId: this.storeId,
    name: this.name,
    email: this.email,
    role: this.role,
    isActive: this.isActive,
    isPlatformAdmin: this.isPlatformAdmin,
  };
};

export default mongoose.model("User", userSchema);