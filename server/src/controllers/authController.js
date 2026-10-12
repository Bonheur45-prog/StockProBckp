import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import asyncHandler from "express-async-handler";
import Store from "../models/Store.js";
import User from "../models/User.js";
import { generateToken } from "../utils/token.js";
import { logAction } from "../utils/audit.js";

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * Every store gets a random suffix, always. The old "-1, -2, ..." counter on
 * a name clash told a new owner that another store with the same name already
 * existed (and how many) — exactly what one tenant must never learn about
 * another. A random suffix on every slug reveals nothing, and also makes
 * slugs impossible to guess one store at a time. Existing stores keep the
 * slug they already have.
 */
async function generateUniqueSlug(storeName) {
  const base = slugify(storeName) || "store";
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
    if (!(await Store.exists({ slug }))) return slug;
  }
  throw new Error("Couldn't create a unique store address — please try again.");
}

// Compared against when an email doesn't exist, so "no such email" takes as
// long as "wrong password" and response time can't be used to tell them apart.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-password", 10);

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

/** "BrightLink Hardware Store" -> "BHS". Just the default — editable
 * afterward in Settings, since an auto-derived abbreviation isn't always
 * the one an owner would actually want on a printed label. */
function deriveSkuPrefix(storeName) {
  const initials = storeName
    .trim()
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return initials.slice(0, 4) || "STR";
}

// POST /api/auth/register-store
// Creates a brand new store (tenant) plus its first user, who becomes owner.
export const registerStore = asyncHandler(async (req, res) => {
  const { storeName, businessType, tin, ownerName, email, password, address, phone, currency, skuPrefix, lowStockThresholdDefault } = req.body;

  if (!storeName || !ownerName || !email || !password) {
    res.status(400);
    throw new Error("storeName, ownerName, email and password are required");
  }
  // Anything but plain text here (an object, an array) would reach Mongoose or
  // bcrypt and crash AFTER the store was already created, leaving an orphan.
  const textFields = [storeName, ownerName, email, password, businessType, tin, address, phone, currency, skuPrefix];
  if (textFields.some((v) => v !== undefined && v !== null && typeof v !== "string")) {
    res.status(400);
    throw new Error("Invalid input");
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    res.status(400);
    throw new Error("Enter a valid email address");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }

  const slug = await generateUniqueSlug(storeName);

  const TRIAL_DAYS = 14;
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const store = await Store.create({
    name: storeName,
    businessType: businessType || "",
    tin: tin || "",
    slug,
    address: address || "",
    phone: phone || "",
    currency: currency || "RWF",
    trialEndsAt,
    skuPrefix: skuPrefix || deriveSkuPrefix(storeName),
    lowStockThresholdDefault: lowStockThresholdDefault || 5,
  });

  let owner;
  try {
    const passwordHash = await User.hashPassword(password);
    owner = await User.create({
      storeId: store._id,
      name: ownerName,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: "owner",
    });
  } catch (err) {
    // Don't leave a store behind that nobody can ever log in to.
    await Store.deleteOne({ _id: store._id });
    throw err;
  }

  await logAction({
    storeId: store._id,
    userId: owner._id,
    action: "store.create",
    entityType: "Store",
    entityId: store._id,
    after: { name: store.name, slug: store.slug },
  });

  const token = generateToken(owner._id);
  res.status(201).json({ token, user: owner.toSafeJSON(), store });
});

// POST /api/auth/login
export const login = asyncHandler(async (req, res) => {
  const { email, password, storeSlug } = req.body;

  // Plain text only: an object here would be treated by Mongo as a query
  // operator (e.g. {"$ne": ""}), not as a value.
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const query = { email: email.toLowerCase().trim() };
  if (typeof storeSlug === "string" && storeSlug.trim()) {
    const store = await Store.findOne({ slug: storeSlug.trim().toLowerCase() });
    if (store) query.storeId = store._id;
  }

  const candidates = await User.find(query);
  if (candidates.length === 0) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    res.status(401);
    throw new Error("Invalid email or password");
  }

  // The same email can exist at more than one store. The password is checked
  // against every candidate FIRST, and only someone who proves they hold the
  // password for several accounts is ever told there is more than one. A
  // visitor guessing emails learns nothing: unknown email, wrong password and
  // "exists at several stores" all look the same to them.
  const matches = [];
  for (const candidate of candidates) {
    const valid = await candidate.comparePassword(password);
    if (valid && candidate.isActive) matches.push(candidate);
  }
  if (matches.length === 0) {
    res.status(401);
    throw new Error("Invalid email or password");
  }
  if (matches.length > 1) {
    res.status(409);
    throw new Error("These sign-in details work for more than one account. Enter your store code to choose one.");
  }

  const user = matches[0];

  let store = null;
  if (!user.isPlatformAdmin) {
    store = await Store.findById(user.storeId);
    if (!store || !store.isActive) {
      res.status(403);
      throw new Error("This store has been suspended. Contact support for help.");
    }
  }

  user.lastLoginAt = new Date();
  await user.save();

  const token = generateToken(user._id);
  res.json({ token, user: user.toSafeJSON(), store });
});

// GET /api/auth/me
export const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  const store = await Store.findById(req.user.storeId);
  res.json({ user: user.toSafeJSON(), store });
});

// PUT /api/auth/me  — update your own name and/or password
export const updateMe = asyncHandler(async (req, res) => {
  const { name, currentPassword, newPassword } = req.body;

  if ([name, currentPassword, newPassword].some((v) => v !== undefined && v !== null && typeof v !== "string")) {
    res.status(400);
    throw new Error("Invalid input");
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  const before = { name: user.name };

  if (name) user.name = name;

  if (newPassword) {
    if (!currentPassword) {
      res.status(400);
      throw new Error("Enter your current password to set a new one");
    }
    const valid = await user.comparePassword(currentPassword);
    if (!valid) {
      res.status(400);
      throw new Error("Current password is incorrect");
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      res.status(400);
      throw new Error("New password must be at least 8 characters");
    }
    user.passwordHash = await User.hashPassword(newPassword);
    // Signs out every OTHER session (an old token is refused from now on);
    // this one gets a fresh token below so the person changing it stays in.
    user.passwordChangedAt = new Date();
  }

  await user.save();

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "user.update-self",
    entityType: "User",
    entityId: user._id,
    before,
    after: { name: user.name, passwordChanged: !!newPassword },
  });

  res.json({ user: user.toSafeJSON(), ...(newPassword ? { token: generateToken(user._id) } : {}) });
});

// POST /api/auth/invite  (owner/manager creates a teammate account)
export const inviteTeammate = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("name, email and password are required");
  }
  if ([name, email, password].some((v) => typeof v !== "string")) {
    res.status(400);
    throw new Error("Invalid input");
  }
  if (!EMAIL_PATTERN.test(email.trim())) {
    res.status(400);
    throw new Error("Enter a valid email address");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }
  if (!["manager", "cashier"].includes(role)) {
    res.status(400);
    throw new Error("role must be manager or cashier");
  }

  const normalizedEmail = email.toLowerCase().trim();
  const alreadyOnTeam = await User.findOne({ storeId: req.user.storeId, email: normalizedEmail });
  if (alreadyOnTeam) {
    res.status(409);
    throw new Error("Someone with that email is already on your team.");
  }

  const passwordHash = await User.hashPassword(password);
  let teammate;
  try {
    teammate = await User.create({
      storeId: req.user.storeId,
      name,
      email: normalizedEmail,
      passwordHash,
      role,
    });
  } catch (err) {
    // Two invites for the same email at the same moment both pass the check
    // above; the database's unique index catches the second. Same friendly
    // answer instead of a generic 500.
    if (err.code === 11000) {
      res.status(409);
      throw new Error("Someone with that email is already on your team.");
    }
    throw err;
  }

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "user.invite",
    entityType: "User",
    entityId: teammate._id,
    after: { name, email, role },
  });

  res.status(201).json({ user: teammate.toSafeJSON() });
});

// GET /api/auth/users  (owner/manager views the team roster)
export const listTeammates = asyncHandler(async (req, res) => {
  const users = await User.find({ storeId: req.user.storeId }).sort({ createdAt: 1 });
  res.json(users.map((u) => u.toSafeJSON()));
});

// PUT /api/auth/users/:id  (owner/manager toggles a teammate's active status
// or changes their role between manager/cashier)
export const updateTeammate = asyncHandler(async (req, res) => {
  const target = await User.findOne({ _id: req.params.id, storeId: req.user.storeId });
  if (!target) {
    res.status(404);
    throw new Error("Teammate not found");
  }

  if (String(target._id) === String(req.user.id)) {
    res.status(400);
    throw new Error("You can't change your own access from here");
  }

  if (target.role === "owner") {
    res.status(400);
    throw new Error("Ownership can't be changed from here");
  }

  const { role, isActive } = req.body;

  if (role !== undefined) {
    if (!["manager", "cashier"].includes(role)) {
      res.status(400);
      throw new Error("role must be manager or cashier");
    }
    target.role = role;
  }

  if (isActive !== undefined) {
    target.isActive = isActive;
  }

  await target.save();

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "user.update",
    entityType: "User",
    entityId: target._id,
    after: { role: target.role, isActive: target.isActive },
  });

  res.json(target.toSafeJSON());
});