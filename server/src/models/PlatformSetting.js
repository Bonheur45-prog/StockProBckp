import mongoose from "mongoose";

/**
 * Platform-wide (not per-store) settings, one document per `key`.
 * Currently only "auth-background": how the public login and
 * create-store pages look. It holds visuals only, nothing private,
 * because the public pages read it without signing in.
 */
const platformSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("PlatformSetting", platformSettingSchema);
