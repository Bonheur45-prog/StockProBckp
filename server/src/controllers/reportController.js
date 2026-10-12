import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import AuditLog from "../models/AuditLog.js";
import Store from "../models/Store.js";
import { parsePaging, parseDateParam } from "../utils/queryParams.js";

// GET /api/reports/dashboard
export const dashboard = asyncHandler(async (req, res) => {
  const storeId = new mongoose.Types.ObjectId(req.user.storeId);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [todayAgg, productCount, products, store] = await Promise.all([
    Sale.aggregate([
      { $match: { storeId, status: "completed", occurredAt: { $gte: startOfToday } } },
      { $group: { _id: null, totalSales: { $sum: "$total" }, count: { $sum: 1 } } },
    ]),
    Product.countDocuments({ storeId, isDeleted: false, isActive: true }),
    Product.find({ storeId, isDeleted: false, isActive: true }, "quantityOnHand lowStockThreshold"),
    Store.findById(req.user.storeId, "lowStockThresholdDefault"),
  ]);

  const lowStockCount = products.filter((p) => p.quantityOnHand <= (p.lowStockThreshold ?? store?.lowStockThresholdDefault ?? 5)).length;

  res.json({
    todaySalesTotal: todayAgg[0]?.totalSales || 0,
    todaySalesCount: todayAgg[0]?.count || 0,
    activeProductCount: productCount,
    lowStockCount,
  });
});

// GET /api/reports/sales-over-time?from=&to=&groupBy=day
export const salesOverTime = asyncHandler(async (req, res) => {
  const storeId = new mongoose.Types.ObjectId(req.user.storeId);
  const rawFrom = parseDateParam(req.query.from);
  const rawTo = parseDateParam(req.query.to);
  if (rawFrom === null || rawTo === null) {
    res.status(400);
    throw new Error("from/to must be valid dates");
  }
  const from = rawFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = rawTo ?? new Date();

  const results = await Sale.aggregate([
    { $match: { storeId, status: "completed", occurredAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt" } },
        total: { $sum: "$total" },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  res.json(results.map((r) => ({ date: r._id, total: r.total, count: r.count })));
});

// GET /api/reports/top-products?from=&to=&limit=10
export const topProducts = asyncHandler(async (req, res) => {
  const storeId = new mongoose.Types.ObjectId(req.user.storeId);
  const rawFrom = parseDateParam(req.query.from);
  const rawTo = parseDateParam(req.query.to);
  if (rawFrom === null || rawTo === null) {
    res.status(400);
    throw new Error("from/to must be valid dates");
  }
  const from = rawFrom ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = rawTo ?? new Date();
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 10, 1), 100);

  const results = await Sale.aggregate([
    { $match: { storeId, status: "completed", occurredAt: { $gte: from, $lte: to } } },
    { $unwind: "$items" },
    {
      $group: {
        // Custom/ad-hoc items have no productId, so group those by name
        // instead — otherwise every custom item would collapse into one
        // misleading "null" bucket labeled with whichever came first.
        _id: { $ifNull: ["$items.productId", "$items.name"] },
        name: { $first: "$items.name" },
        quantitySold: { $sum: "$items.quantity" },
        revenue: { $sum: "$items.lineTotal" },
      },
    },
    { $sort: { revenue: -1 } },
    { $limit: limit },
  ]);

  res.json(results);
});

// GET /api/reports/low-stock
export const lowStock = asyncHandler(async (req, res) => {
  const [products, store] = await Promise.all([
    Product.find({ storeId: req.user.storeId, isDeleted: false, isActive: true }).sort({ name: 1 }),
    Store.findById(req.user.storeId, "lowStockThresholdDefault"),
  ]);
  const low = products.filter((p) => p.quantityOnHand <= (p.lowStockThreshold ?? store?.lowStockThresholdDefault ?? 5));
  res.json(low);
});

// GET /api/reports/activity?page=&limit=&from=&to=  (premium: accountability / audit feed)
export const activityFeed = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 50 });
  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  if (from === null || to === null) {
    res.status(400);
    throw new Error("from/to must be valid dates");
  }

  const query = { storeId: req.user.storeId };
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lte = to;
  }

  const [rows, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("userId", "name role isPlatformAdmin"),
    AuditLog.countDocuments(query),
  ]);

  // Platform (BrightLink) staff act on a store only for support; the store
  // sees a generic label, never the staff member's name.
  const items = rows.map((row) => {
    const o = row.toObject();
    if (o.userId?.isPlatformAdmin) o.userId = { name: "BrightLink support", role: "support" };
    else if (o.userId) delete o.userId.isPlatformAdmin;
    return o;
  });

  res.json({ items, total, page, limit });
});

// GET /api/reports/staff-performance?from=&to=  (owner/manager only, enforced in route)
export const staffPerformance = asyncHandler(async (req, res) => {
  const storeId = new mongoose.Types.ObjectId(req.user.storeId);
  const rawFrom = parseDateParam(req.query.from);
  const rawTo = parseDateParam(req.query.to);
  if (rawFrom === null || rawTo === null) {
    res.status(400);
    throw new Error("from/to must be valid dates");
  }
  const from = rawFrom ?? new Date(0);
  const to = rawTo ?? new Date();

  const results = await Sale.aggregate([
    { $match: { storeId, status: "completed", occurredAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: "$soldByUserId",
        salesCount: { $sum: 1 },
        revenue: { $sum: "$total" },
        // Per-document item total, then summed across the group — avoids an
        // $unwind, which would multiply sale documents and break salesCount.
        itemsSold: {
          $sum: { $reduce: { input: "$items", initialValue: 0, in: { $add: ["$$value", "$$this.quantity"] } } },
        },
      },
    },
    { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        userId: "$_id",
        name: { $ifNull: ["$user.name", "Removed user"] },
        role: "$user.role",
        salesCount: 1,
        revenue: 1,
        itemsSold: 1,
      },
    },
    { $sort: { revenue: -1 } },
  ]);

  res.json(results);
});
