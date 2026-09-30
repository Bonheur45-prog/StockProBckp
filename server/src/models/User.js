import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const userSchema = new mongoose.Schema(
  {
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["owner", "manager", "cashier"],
      default: "cashier",
    },
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
  };
};

export default mongoose.model("User", userSchema);
