import asyncHandler from "express-async-handler";
import Store from "../models/Store.js";
import User from "../models/User.js";
import Product from "../models/Product.js";

// GET /api/admin/stores
export const listStores = asyncHandler(async (req, res) => {
  const stores = await Store.find().sort({ createdAt: -1 });

  const result = await Promise.all(
    stores.map(async (store) => {
      const [owner, userCount, productCount] = await Promise.all([
        User.findOne({ storeId: store._id, role: "owner" }).sort({ createdAt: 1 }),
        User.countDocuments({ storeId: store._id }),
        Product.countDocuments({ storeId: store._id, isDeleted: { $ne: true } }),
      ]);
      return {
        id: store._id,
        name: store.name,
        businessType: store.businessType || "",
        slug: store.slug,
        plan: store.plan,
        trialEndsAt: store.trialEndsAt,
        isActive: store.isActive,
        createdAt: store.createdAt,
        ownerName: owner?.name || "",
        ownerEmail: owner?.email || "",
        userCount,
        productCount,
      };
    })
  );

  res.json(result);
});

// GET /api/admin/stores/:id
export const getStoreDetail = asyncHandler(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) {
    res.status(404);
    throw new Error("Store not found");
  }

  const [team, productCount] = await Promise.all([
    User.find({ storeId: store._id }).sort({ createdAt: 1 }),
    Product.countDocuments({ storeId: store._id, isDeleted: { $ne: true } }),
  ]);

  res.json({
    store,
    team: team.map((u) => u.toSafeJSON()),
    productCount,
  });
});

// PUT /api/admin/stores/:id  — the only fields an admin can change: plan,
// trial end date, and active/suspended. Everything else about a store
// (name, address, SKU prefix, etc.) stays the owner's own business via
// Settings, not something to override from here.
export const updateStoreAdmin = asyncHandler(async (req, res) => {
  const store = await Store.findById(req.params.id);
  if (!store) {
    res.status(404);
    throw new Error("Store not found");
  }

  const { plan, trialEndsAt, isActive } = req.body;

  if (plan !== undefined) {
    if (!["free", "pro", "premium"].includes(plan)) {
      res.status(400);
      throw new Error("plan must be free, pro or premium");
    }
    store.plan = plan;
  }
  if (trialEndsAt !== undefined) {
    store.trialEndsAt = trialEndsAt ? new Date(trialEndsAt) : null;
  }
  if (isActive !== undefined) {
    store.isActive = isActive;
  }

  await store.save();
  res.json(store);
});

// GET /api/admin/dashboard
export const getDashboard = asyncHandler(async (req, res) => {
  const stores = await Store.find();
  const now = new Date();

  const totals = { stores: stores.length, suspended: 0, trialActive: 0, trialExpired: 0, byPlan: { free: 0, pro: 0, premium: 0 }, byBusinessType: {} };

  for (const store of stores) {
    if (!store.isActive) totals.suspended += 1;
    else if (store.trialEndsAt && store.trialEndsAt > now) totals.trialActive += 1;
    else if (store.trialEndsAt && store.trialEndsAt <= now) totals.trialExpired += 1;

    totals.byPlan[store.plan] = (totals.byPlan[store.plan] || 0) + 1;

    const type = store.businessType || "Unspecified";
    totals.byBusinessType[type] = (totals.byBusinessType[type] || 0) + 1;
  }

  // Signups per month, last 6 months — simple enough at this scale to do
  // in JS rather than an aggregation pipeline.
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleString("en", { month: "short" }), count: 0 });
  }
  for (const store of stores) {
    const key = `${store.createdAt.getFullYear()}-${String(store.createdAt.getMonth() + 1).padStart(2, "0")}`;
    const bucket = months.find((m) => m.key === key);
    if (bucket) bucket.count += 1;
  }

  res.json({ totals, signupsByMonth: months });
});

// GET /api/admin/users?email=...  — support tool: find an account by email
// across every store, regardless of tenant.
export const searchUsers = asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email || email.trim().length < 3) {
    res.status(400);
    throw new Error("Give at least 3 characters to search by");
  }

  const users = await User.find({ email: { $regex: email.trim(), $options: "i" } }).limit(20);
  const storeIds = [...new Set(users.map((u) => u.storeId?.toString()).filter(Boolean))];
  const stores = await Store.find({ _id: { $in: storeIds } });
  const storeById = Object.fromEntries(stores.map((s) => [s._id.toString(), s]));

  res.json(
    users.map((u) => ({
      ...u.toSafeJSON(),
      storeName: u.storeId ? storeById[u.storeId.toString()]?.name || "" : "",
    }))
  );
});

// PUT /api/admin/users/:id/reset-password — the only real recovery path
// right now, since there's no email-based reset flow anywhere in the app.
export const resetUserPassword = asyncHandler(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    res.status(400);
    throw new Error("newPassword must be at least 8 characters");
  }

  const user = await User.findById(req.params.id);
  if (!user) {
    res.status(404);
    throw new Error("User not found");
  }

  user.passwordHash = await User.hashPassword(newPassword);
  await user.save();

  res.json({ success: true });
});