import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import StockMovement from "../models/StockMovement.js";
import { logAction } from "../utils/audit.js";
import { resolveProductRefs } from "../utils/productRef.js";

/**
 * Applies a stock movement to a product and writes the movement record,
 * inside a transaction so quantityOnHand and the movement log can never
 * drift apart. Falls back to non-transactional writes if the connected
 * MongoDB deployment doesn't support transactions (e.g. a standalone
 * instance during local dev) — fine for a solo-dev MVP.
 */
export async function applyStockMovement({ storeId, productId, type, quantityChange, reason, relatedSaleId, userId, clientId }) {
  if (clientId) {
    const existing = await StockMovement.findOne({ storeId, clientId });
    if (existing) return existing; // idempotent: sync retries won't double-apply
  }

  const session = await mongoose.startSession();
  let movement;
  try {
    await session.withTransaction(async () => {
      // productId may be a real Mongo _id, or a client-generated UUID if
      // this movement was created offline before the product itself had
      // synced — resolve either form to the real product document.
      const productMap = await resolveProductRefs(storeId, [productId], session);
      const product = productMap.get(productId);
      if (!product) throw Object.assign(new Error("Product not found"), { statusCode: 404 });

      const quantityAfter = product.quantityOnHand + quantityChange;
      if (quantityAfter < 0) {
        throw Object.assign(new Error(`Insufficient stock for ${product.name}`), { statusCode: 400 });
      }

      product.quantityOnHand = quantityAfter;
      product.updatedBy = userId;
      await product.save({ session });

      const created = await StockMovement.create(
        [
          {
            storeId,
            productId: product._id,
            type,
            quantityChange,
            quantityAfter,
            reason,
            relatedSaleId,
            createdBy: userId,
            updatedBy: userId,
            clientId,
          },
        ],
        { session }
      );
      movement = created[0];
    });
  } catch (err) {
    // Standalone Mongo (no replica set) can't run transactions at all.
    if (err.message?.includes("Transaction numbers")) {
      const productMap = await resolveProductRefs(storeId, [productId]);
      const product = productMap.get(productId);
      if (!product) throw Object.assign(new Error("Product not found"), { statusCode: 404 });
      const quantityAfter = product.quantityOnHand + quantityChange;
      if (quantityAfter < 0) throw Object.assign(new Error(`Insufficient stock for ${product.name}`), { statusCode: 400 });
      product.quantityOnHand = quantityAfter;
      product.updatedBy = userId;
      await product.save();
      movement = await StockMovement.create({
        storeId, productId: product._id, type, quantityChange, quantityAfter, reason, relatedSaleId, createdBy: userId, updatedBy: userId, clientId,
      });
    } else {
      throw err;
    }
  } finally {
    session.endSession();
  }
  return movement;
}


// POST /api/stock/restock  { productId, quantity, reason }
export const restock = asyncHandler(async (req, res) => {
  const { productId, quantity, reason, clientId } = req.body;
  if (!productId || !quantity || Number(quantity) <= 0) {
    res.status(400);
    throw new Error("productId and a positive quantity are required");
  }

  const movement = await applyStockMovement({
    storeId: req.user.storeId,
    productId,
    type: "restock",
    quantityChange: Number(quantity),
    reason,
    userId: req.user.id,
    clientId,
  });

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "stock.restock",
    entityType: "StockMovement",
    entityId: movement._id,
    after: movement.toObject(),
  });

  res.status(201).json(movement);
});

// POST /api/stock/adjust  { productId, quantityChange, reason }  (+ or -, e.g. damage, count correction)
export const adjustStock = asyncHandler(async (req, res) => {
  const { productId, quantityChange, reason, clientId } = req.body;
  if (!productId || quantityChange === undefined || Number(quantityChange) === 0) {
    res.status(400);
    throw new Error("productId and a non-zero quantityChange are required");
  }
  if (!reason) {
    res.status(400);
    throw new Error("reason is required for manual adjustments (accountability)");
  }

  const movement = await applyStockMovement({
    storeId: req.user.storeId,
    productId,
    type: "adjustment",
    quantityChange: Number(quantityChange),
    reason,
    userId: req.user.id,
    clientId,
  });

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "stock.adjust",
    entityType: "StockMovement",
    entityId: movement._id,
    after: movement.toObject(),
  });

  res.status(201).json(movement);
});

// GET /api/stock/movements?productId=&from=&to=&page=&limit=
export const listMovements = asyncHandler(async (req, res) => {
  const { productId, from, to, page = 1, limit = 50 } = req.query;

  const query = { storeId: req.user.storeId };
  if (productId) query.productId = productId;
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    StockMovement.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).populate("productId", "name sku"),
    StockMovement.countDocuments(query),
  ]);

  res.json({ items, total, page: Number(page), limit: Number(limit) });
});
