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
  if (password.length < 8) {
    res.status(400);
    throw new Error("Password must be at least 8 characters");
  }

  const baseSlug = slugify(storeName);
  let slug = baseSlug;
  let suffix = 1;
  while (await Store.exists({ slug })) {
    slug = `${baseSlug}-${suffix++}`;
  }

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

  const passwordHash = await User.hashPassword(password);
  const owner = await User.create({
    storeId: store._id,
    name: ownerName,
    email: email.toLowerCase().trim(),
    passwordHash,
    role: "owner",
  });

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

  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required");
  }

  const query = { email: email.toLowerCase().trim() };
  if (storeSlug) {
    const store = await Store.findOne({ slug: storeSlug });
    if (store) query.storeId = store._id;
  }

  // Same email could exist at more than one store; if storeSlug wasn't
  // given and there are multiple matches, ask the client to disambiguate.
  const candidates = await User.find(query);
  if (candidates.length === 0) {
    res.status(401);
    throw new Error("Invalid email or password");
  }
  if (candidates.length > 1) {
    res.status(409);
    throw new Error("Multiple stores found for this email — please specify storeSlug");
  }

  const user = candidates[0];
  const valid = await user.comparePassword(password);
  if (!valid || !user.isActive) {
    res.status(401);
    throw new Error("Invalid email or password");
  }

  user.lastLoginAt = new Date();
  await user.save();

  const store = await Store.findById(user.storeId);
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
    if (newPassword.length < 8) {
      res.status(400);
      throw new Error("New password must be at least 8 characters");
    }
    user.passwordHash = await User.hashPassword(newPassword);
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

  res.json({ user: user.toSafeJSON() });
});

// POST /api/auth/invite  (owner/manager creates a teammate account)
export const inviteTeammate = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password) {
    res.status(400);
    throw new Error("name, email and password are required");
  }
  if (!["manager", "cashier"].includes(role)) {
    res.status(400);
    throw new Error("role must be manager or cashier");
  }

  const passwordHash = await User.hashPassword(password);
  const teammate = await User.create({
    storeId: req.user.storeId,
    name,
    email: email.toLowerCase().trim(),
    passwordHash,
    role,
  });

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