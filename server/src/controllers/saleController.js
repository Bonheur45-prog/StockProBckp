import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import Product from "../models/Product.js";
import StockMovement from "../models/StockMovement.js";
import { logAction } from "../utils/audit.js";
import { resolveProductRefs } from "../utils/productRef.js";

/**
 * Core sale-creation logic, reused by both the direct POST /api/sales route
 * and the offline sync push handler (so a sale made offline goes through
 * exactly the same stock-decrement + audit path as one made online).
 * Idempotent on clientId: if a sale with this clientId already exists for
 * the store, it's returned as-is instead of being double-applied — this is
 * what makes retried sync pushes safe.
 *
 * userRole gates catalog price overrides: a cashier submitting a unitPrice
 * that differs from the product's catalog sellPrice is rejected (matches
 * the owner/manager restriction already in place on direct product edits —
 * this used to be enforceable only via UI, so any authenticated cashier
 * could send an arbitrary unitPrice through either route). Owner/manager
 * keep unrestricted override, since negotiating price is a real feature.
 * Discount, and every unitPrice (catalog override or custom line), are
 * validated as finite, non-negative numbers, and discount can never exceed
 * subtotal — previously an out-of-range discount just floored the total at
 * 0 instead of being rejected, silently masking a bad input.
 */
export async function performSaleCreation(storeId, userId, payload, userRole) {
  const { items, discount = 0, paymentMethod = "cash", customerName, customerPhone, occurredAt, clientId } = payload;

  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error("At least one line item is required"), { statusCode: 400 });
  }

  const discountNum = discount === undefined || discount === null ? 0 : Number(discount);
  if (!Number.isFinite(discountNum) || discountNum < 0) {
    throw Object.assign(new Error("Discount must be a non-negative number"), { statusCode: 400 });
  }

  if (clientId) {
    const existing = await Sale.findOne({ storeId, clientId });
    if (existing) return existing;
  }

  let sale;

  const runSale = async (session) => {
    const opts = session ? { session } : {};
    const productItems = items.filter((i) => !i.isCustom && i.productId);
    const customItems = items.filter((i) => i.isCustom || !i.productId);

    const productIds = productItems.map((i) => i.productId);
    // includeDeleted: a sale is a record of something that ALREADY happened (money
    // taken, goods handed over). If the product was deleted while this device
    // was offline, rejecting the sale would turn real revenue into a stuck
    // record someone might discard. So it is accepted and recorded.
    const productMap = await resolveProductRefs(storeId, productIds, session, { includeDeleted: true });

    let subtotal = 0;
    const saleItems = [];
    const movementDocs = [];

    for (const item of productItems) {
      const product = productMap.get(item.productId);
      if (!product) throw Object.assign(new Error(`Product ${item.productId} not found`), { statusCode: 404 });
      const quantity = Number(item.quantity);
      if (!quantity || quantity <= 0) throw Object.assign(new Error(`Invalid quantity for ${product.name}`), { statusCode: 400 });
      if (product.quantityOnHand < quantity) {
        throw Object.assign(new Error(`Not enough stock for ${product.name} (have ${product.quantityOnHand})`), { statusCode: 400 });
      }

      const hasOverride = item.unitPrice !== undefined && item.unitPrice !== null;
      const unitPrice = hasOverride ? Number(item.unitPrice) : product.sellPrice;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw Object.assign(new Error(`Invalid price for ${product.name}`), { statusCode: 400 });
      }
      if (hasOverride && Math.abs(unitPrice - product.sellPrice) > 0.0001 && userRole === "cashier") {
        throw Object.assign(new Error(`Only an owner or manager can override the price for ${product.name}`), { statusCode: 403 });
      }
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      subtotal += lineTotal;

      // Cost snapshot. An offline sale carries the cost the DEVICE knew at
      // the moment of sale — more accurate than the cost on the server by
      // the time the sale syncs, so a valid client value wins. Anything
      // missing/invalid (REST sales, older app versions) falls back to the
      // product's cost right now. A device could in principle send a made-up
      // cost; that only skews its own store's P&L, which we accept.
      const clientCost = item.unitCost === undefined || item.unitCost === null || item.unitCost === "" ? NaN : Number(item.unitCost);
      const unitCost = Number.isFinite(clientCost) && clientCost >= 0 ? clientCost : Number(product.costPrice) || 0;

      saleItems.push({ productId: product._id, name: product.name, unitPrice, unitCost, quantity, lineTotal, isCustom: false });

      product.quantityOnHand -= quantity;
      product.updatedBy = userId;
      await product.save(opts);

      movementDocs.push({
        storeId,
        productId: product._id,
        type: "sale",
        quantityChange: -quantity,
        quantityAfter: product.quantityOnHand,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    // Custom/ad-hoc items aren't tied to catalog stock, so there's no
    // product lookup or stock movement — just a priced line on the receipt.
    for (const item of customItems) {
      if (!item.name) throw Object.assign(new Error("Custom items need a name"), { statusCode: 400 });
      const quantity = Number(item.quantity) || 1;
      const unitPrice = Number(item.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw Object.assign(new Error(`Invalid price for ${item.name}`), { statusCode: 400 });
      const lineTotal = Math.round(unitPrice * quantity * 100) / 100;
      subtotal += lineTotal;
      saleItems.push({ name: item.name, unitPrice, quantity, lineTotal, isCustom: true });
    }

    subtotal = Math.round(subtotal * 100) / 100;
    if (discountNum > subtotal) {
      throw Object.assign(new Error(`Discount (${discountNum}) cannot exceed subtotal (${subtotal})`), { statusCode: 400 });
    }
    const total = Math.round((subtotal - discountNum) * 100) / 100;

    const created = await Sale.create(
      [
        {
          storeId,
          items: saleItems,
          subtotal,
          discount: discountNum,
          total,
          paymentMethod,
          customerName,
          customerPhone,
          soldByUserId: userId,
          occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
          clientId,
          createdBy: userId,
          updatedBy: userId,
        },
      ],
      opts
    );
    sale = created[0];

    for (const m of movementDocs) m.relatedSaleId = sale._id;
    await StockMovement.insertMany(movementDocs, opts);
  };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(() => runSale(session));
  } catch (err) {
    if (err.message?.includes("Transaction numbers")) {
      await runSale(null); // standalone Mongo fallback (no replica set)
    } else {
      throw err;
    }
  } finally {
    session.endSession();
  }

  await logAction({
    storeId,
    userId,
    action: "sale.create",
    entityType: "Sale",
    entityId: sale._id,
    after: sale.toObject(),
  });

  return sale;
}

// POST /api/sales
// body: { items: [{ productId, quantity }], discount, paymentMethod, customerName, customerPhone, occurredAt, clientId }
export const createSale = asyncHandler(async (req, res) => {
  try {
    const sale = await performSaleCreation(req.user.storeId, req.user.id, req.body, req.user.role);
    res.status(201).json(sale);
  } catch (err) {
    res.status(err.statusCode || 500);
    throw err;
  }
});

// GET /api/sales?from=&to=&status=&page=&limit=
export const listSales = asyncHandler(async (req, res) => {
  const { from, to, status, page = 1, limit = 50 } = req.query;

  const query = { storeId: req.user.storeId };
  if (status) query.status = status;
  if (from || to) {
    query.occurredAt = {};
    if (from) query.occurredAt.$gte = new Date(from);
    if (to) query.occurredAt.$lte = new Date(to);
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total] = await Promise.all([
    Sale.find(query).sort({ occurredAt: -1 }).skip(skip).limit(Number(limit)).populate("soldByUserId", "name"),
    Sale.countDocuments(query),
  ]);

  res.json({ items, total, page: Number(page), limit: Number(limit) });
});

// GET /api/sales/:id
export const getSale = asyncHandler(async (req, res) => {
  const sale = await Sale.findOne({ _id: req.params.id, storeId: req.user.storeId }).populate("soldByUserId", "name");
  if (!sale) {
    res.status(404);
    throw new Error("Sale not found");
  }
  res.json(sale);
});

// POST /api/sales/:id/void   (restores stock, requires manager/owner)
export const voidSale = asyncHandler(async (req, res) => {
  // Atomically claim this sale for voiding: flips status only if it's
  // still "completed" right now. If two void requests for the same sale
  // land concurrently, only one of them gets a non-null result back here
  // — the other's conditional match fails (status is no longer
  // "completed" by the time it runs) and it stops here instead of also
  // restoring stock a second time.
  const sale = await Sale.findOneAndUpdate(
    { _id: req.params.id, storeId: req.user.storeId, status: "completed" },
    { $set: { status: "voided", updatedBy: req.user.id } },
    { new: true }
  );

  if (!sale) {
    const exists = await Sale.exists({ _id: req.params.id, storeId: req.user.storeId });
    res.status(exists ? 400 : 404);
    throw new Error(exists ? "Only a completed sale can be voided" : "Sale not found");
  }

  const before = { ...sale.toObject(), status: "completed" }; // only status/updatedBy changed by the claim above

  for (const item of sale.items) {
    if (!item.productId) continue; // custom/ad-hoc line item — no catalog stock to restore
    const product = await Product.findOne({ _id: item.productId, storeId: req.user.storeId });
    if (product) {
      product.quantityOnHand += item.quantity;
      product.updatedBy = req.user.id;
      await product.save();

      await StockMovement.create({
        storeId: req.user.storeId,
        productId: product._id,
        type: "return",
        quantityChange: item.quantity,
        quantityAfter: product.quantityOnHand,
        reason: `Void of sale ${sale._id}`,
        relatedSaleId: sale._id,
        createdBy: req.user.id,
        updatedBy: req.user.id,
      });
    }
  }

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "sale.void",
    entityType: "Sale",
    entityId: sale._id,
    before,
    after: sale.toObject(),
  });

  res.json(sale);
});