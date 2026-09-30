import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import AuditLog from "../models/AuditLog.js";
import Store from "../models/Store.js";

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
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(req.query.to) : new Date();

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
  const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const limit = Number(req.query.limit) || 10;

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
  const { page = 1, limit = 50, from, to } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const query = { storeId: req.user.storeId };
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const [items, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("userId", "name role"),
    AuditLog.countDocuments(query),
  ]);

  res.json({ items, total, page: Number(page), limit: Number(limit) });
});

// GET /api/reports/staff-performance?from=&to=  (owner/manager only, enforced in route)
export const staffPerformance = asyncHandler(async (req, res) => {
  const storeId = new mongoose.Types.ObjectId(req.user.storeId);
  const from = req.query.from ? new Date(req.query.from) : new Date(0);
  const to = req.query.to ? new Date(req.query.to) : new Date();

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
