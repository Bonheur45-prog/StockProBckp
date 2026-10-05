// Creates a platform-admin account — the only way one ever gets created,
// deliberately never through the public /register-store form.
//
// Usage (run from server/):
//   node scripts/createPlatformAdmin.mjs "you@brightlink.rw" "a-strong-password" "Your Name"
//
// Requires MONGO_URI in the environment, same as the running server.

import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../src/models/User.js";

dotenv.config();

async function main() {
  const [, , email, password, name] = process.argv;

  if (!email || !password || !name) {
    console.error('Usage: node scripts/createPlatformAdmin.mjs "email" "password" "Full Name"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set in the environment.");
    process.exit(1);
  }

  await mongoose.connect(uri);

  const existing = await User.findOne({ email: email.toLowerCase().trim(), isPlatformAdmin: true });
  if (existing) {
    console.error(`A platform admin with email ${email} already exists.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const passwordHash = await User.hashPassword(password);
  const admin = await User.create({
    name,
    email: email.toLowerCase().trim(),
    passwordHash,
    isPlatformAdmin: true,
    isActive: true,
    role: "owner", // unused for admins, but role is required by the schema
  });

  console.log(`Platform admin created: ${admin.email} (id ${admin._id})`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
