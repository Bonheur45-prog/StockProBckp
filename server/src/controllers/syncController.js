import asyncHandler from "express-async-handler";
import Product from "../models/Product.js";
import { assertNoDuplicateCodes } from "../utils/productCodes.js";
import Sale from "../models/Sale.js";
import StockMovement from "../models/StockMovement.js";
import CreditPayment from "../models/CreditPayment.js";
import Supplier from "../models/Supplier.js";
import PurchaseOrder from "../models/PurchaseOrder.js";
import { performSaleCreation } from "./saleController.js";
import { applyStockMovement } from "./stockController.js";
import { performRecordPayment } from "./creditController.js";
import { performReceivePurchaseOrder, performCreatePurchaseOrder } from "./purchaseOrderController.js";
import { uploadBufferToCloudinary } from "../config/cloudinary.js";

/**
 * Every deliberate, expected error thrown by the shared create/action
 * functions this file calls (performSaleCreation, applyStockMovement,
 * performCreatePurchaseOrder, etc.) carries an explicit statusCode
 * property (e.g. Object.assign(new Error("..."), { statusCode: 400 })).
 * That's the signal used here to decide what's safe to put in front of
 * the person looking at the "couldn't sync" recovery screen — same
 * principle as errorHandler.js's global catch-all, but checked
 * differently, since these per-item catches never touch Express's
 * response object (there's no res.status() call to inspect here; this is
 * a plain try/catch inside a loop, not a request/response cycle).
 *
 * A 4xx statusCode means "one of our own validation checks rejected
 * this" — safe to show verbatim, and in fact the whole point of this
 * screen. Anything else (no statusCode, or a genuinely unexpected
 * exception — a database hiccup, a malformed document, a bug) could
 * contain internal details that shouldn't reach an end user; those get
 * logged server-side and replaced with a generic message instead.
 */
function safeSyncErrorMessage(err, context) {
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {}).find((k) => k !== "storeId") || "value";
    return `That ${field} is already used by another product in this store.`;
  }
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return err.message || "Rejected";
  }
  console.error(`[unhandled sync push error] ${context}`, err);
  return "Couldn't process this — please try again, or contact support if it keeps happening.";
}

/** Two products in the same store may never share a barcode/QR value or a
 * SKU — enforced here via the shared assertNoDuplicateCodes (imported
 * above), which is also used by the direct REST product routes so both
 * entry points stay in sync. */

/**
 * GET /api/sync/pull?since=<ISO timestamp>
 *
 * Returns everything changed (created/updated/soft-deleted) since `since`,
 * plus a `serverTime` the client should store and send back as `since` on
 * the next pull. Using server time (not the max updatedAt seen) avoids a
 * race where a write lands between "query ran" and "client saved cursor".
 */
export const pull = asyncHandler(async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const storeId = req.user.storeId;
  const serverTime = new Date();

  const [products, sales, stockMovements, creditPayments, suppliers, purchaseOrders] = await Promise.all([
    Product.find({ storeId, updatedAt: { $gte: since } }),
    Sale.find({ storeId, updatedAt: { $gte: since } }),
    StockMovement.find({ storeId, updatedAt: { $gte: since } }),
    CreditPayment.find({ storeId, updatedAt: { $gte: since } }),
    Supplier.find({ storeId, updatedAt: { $gte: since } }),
    PurchaseOrder.find({ storeId, updatedAt: { $gte: since } }),
  ]);

  res.json({ serverTime, products, sales, stockMovements, creditPayments, suppliers, purchaseOrders });
});

/**
 * POST /api/sync/push
 * body: { products: [...], sales: [...], stockMovements: [...] }
 *
 * Every item MUST carry a clientId generated on-device when it was first
 * created offline — that's what makes replaying a push after a dropped
 * connection safe (no duplicate sales, no double stock decrements).
 *
 * Conflict rule for products (the only entity users edit in place):
 * last-write-wins by comparing the client's local updatedAt against the
 * server document's updatedAt. Sales and stock movements are append-only
 * from the client's point of view, so there's nothing to "conflict" —
 * either the clientId already exists (skip) or it doesn't (create).
 *
 * Role gate: the direct REST routes (productRoutes, stockRoutes,
 * supplierRoutes, purchaseOrderRoutes) already restrict catalog/inventory
 * mutations to owner/manager via requireRole(). This handler used to skip
 * that check entirely — any authenticated cashier could push a product
 * edit, stock movement, supplier change, or purchase order straight
 * through sync and it would apply. Each category below is now gated to
 * match its direct-route equivalent; sales and credit payments are left
 * open to any role, since cashiers legitimately create both through the
 * direct routes too. A disallowed item is rejected into results.errors
 * (not a hard 403 for the whole push) so one blocked item doesn't fail an
 * otherwise-legitimate batch of the same user's own sales in the same push.
 */
export const push = asyncHandler(async (req, res) => {
  const storeId = req.user.storeId;
  const userId = req.user.id;
  const userRole = req.user.role;
  const canManageCatalog = userRole === "owner" || userRole === "manager";
  const { products = [], sales = [], stockMovements = [], creditPayments = [], suppliers = [], purchaseOrders = [], poReceipts = [] } = req.body;

  const results = {
    products: [], sales: [], stockMovements: [], creditPayments: [],
    suppliers: [], purchaseOrders: [], poReceipts: [], errors: [],
  };

  // --- Products (create or last-write-wins update) ---
  for (const p of products) {
    try {
      if (!canManageCatalog) throw Object.assign(new Error("role does not permit product changes"), { statusCode: 403 });
      if (!p.clientId) throw new Error("product missing clientId");
      await assertNoDuplicateCodes(storeId, p, p.clientId);

      const existing = await Product.findOne({ storeId, clientId: p.clientId });
      if (existing) {
        const clientUpdatedAt = p.updatedAt ? new Date(p.updatedAt) : null;
        if (clientUpdatedAt && clientUpdatedAt > existing.updatedAt) {
          Object.assign(existing, {
            name: p.name, sku: p.sku, barcode: p.barcode, category: p.category, unit: p.unit,
            costPrice: p.costPrice, sellPrice: p.sellPrice, lowStockThreshold: p.lowStockThreshold,
            isActive: p.isActive, isDeleted: p.isDeleted,
            // Photos are uploaded separately (POST /sync/upload-queued-image)
            // and the resulting URL is carried on the product record from
            // then on — it must survive every subsequent sync push/pull or
            // the image "disappears" once a later edit syncs. This was the
            // bug: these two fields were missing here before.
            imageUrl: p.imageUrl !== undefined ? p.imageUrl : existing.imageUrl,
            imagePublicId: p.imagePublicId !== undefined ? p.imagePublicId : existing.imagePublicId,
          });
          existing.updatedBy = userId;
          await existing.save();
        }
        results.products.push(existing);
      } else {
        const created = await Product.create({
          storeId,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          category: p.category,
          unit: p.unit,
          costPrice: p.costPrice || 0,
          sellPrice: p.sellPrice,
          quantityOnHand: p.quantityOnHand || 0,
          lowStockThreshold: p.lowStockThreshold ?? null,
          imageUrl: p.imageUrl || undefined,
          imagePublicId: p.imagePublicId || undefined,
          clientId: p.clientId,
          createdBy: userId,
          updatedBy: userId,
        });
        results.products.push(created);
      }
    } catch (err) {
      results.errors.push({ type: "product", clientId: p.clientId, message: safeSyncErrorMessage(err, "product") });
    }
  }

  // --- Stock movements (restocks/adjustments made offline) ---
  for (const m of stockMovements) {
    try {
      if (!canManageCatalog) throw Object.assign(new Error("role does not permit stock movements"), { statusCode: 403 });
      if (!m.clientId) throw new Error("stock movement missing clientId");
      const movement = await applyStockMovement({
        storeId,
        productId: m.productId,
        type: m.type,
        quantityChange: m.quantityChange,
        reason: m.reason,
        userId,
        clientId: m.clientId,
      });
      results.stockMovements.push(movement);
    } catch (err) {
      results.errors.push({ type: "stockMovement", clientId: m.clientId, message: safeSyncErrorMessage(err, "stockMovement") });
    }
  }

  // --- Sales made offline (POS keeps working with no signal) ---
  for (const s of sales) {
    try {
      if (!s.clientId) throw new Error("sale missing clientId");
      const sale = await performSaleCreation(storeId, userId, s, userRole);
      results.sales.push(sale);
    } catch (err) {
      results.errors.push({ type: "sale", clientId: s.clientId, message: safeSyncErrorMessage(err, "sale") });
    }
  }

  // --- Credit payments made offline ---
  for (const c of creditPayments) {
    try {
      if (!c.clientId) throw new Error("credit payment missing clientId");
      const payment = await performRecordPayment(storeId, userId, c);
      results.creditPayments.push(payment);
    } catch (err) {
      results.errors.push({ type: "creditPayment", clientId: c.clientId, message: safeSyncErrorMessage(err, "creditPayment") });
    }
  }

  // --- Suppliers (create or last-write-wins update) ---
  for (const s of suppliers) {
    try {
      if (!canManageCatalog) throw Object.assign(new Error("role does not permit supplier changes"), { statusCode: 403 });
      if (!s.clientId) throw new Error("supplier missing clientId");
      const existing = await Supplier.findOne({ storeId, clientId: s.clientId });
      if (existing) {
        const clientUpdatedAt = s.updatedAt ? new Date(s.updatedAt) : null;
        if (clientUpdatedAt && clientUpdatedAt > existing.updatedAt) {
          Object.assign(existing, {
            name: s.name, phone: s.phone, email: s.email, address: s.address,
            notes: s.notes, isActive: s.isActive, isDeleted: s.isDeleted,
          });
          existing.updatedBy = userId;
          await existing.save();
        }
        results.suppliers.push(existing);
      } else {
        const created = await Supplier.create({
          storeId, name: s.name, phone: s.phone, email: s.email, address: s.address, notes: s.notes,
          clientId: s.clientId, createdBy: userId, updatedBy: userId,
        });
        results.suppliers.push(created);
      }
    } catch (err) {
      results.errors.push({ type: "supplier", clientId: s.clientId, message: safeSyncErrorMessage(err, "supplier") });
    }
  }

  // --- Purchase orders created offline ---
  for (const po of purchaseOrders) {
    try {
      if (!canManageCatalog) throw Object.assign(new Error("role does not permit purchase orders"), { statusCode: 403 });
      if (!po.clientId) throw new Error("purchase order missing clientId");
      const order = await performCreatePurchaseOrder(storeId, userId, po);
      results.purchaseOrders.push(order);
    } catch (err) {
      results.errors.push({ type: "purchaseOrder", clientId: po.clientId, message: safeSyncErrorMessage(err, "purchaseOrder") });
    }
  }

  // --- Receiving stock against a PO, made offline (e.g. at the storeroom, no signal) ---
  for (const r of poReceipts) {
    try {
      if (!canManageCatalog) throw Object.assign(new Error("role does not permit receiving purchase orders"), { statusCode: 403 });
      if (!r.clientId) throw new Error("PO receipt missing clientId");
      const order = await performReceivePurchaseOrder(storeId, userId, r.purchaseOrderId, r);
      results.poReceipts.push({ clientId: r.clientId, purchaseOrder: order });
    } catch (err) {
      results.errors.push({ type: "poReceipt", clientId: r.clientId, message: safeSyncErrorMessage(err, "poReceipt") });
    }
  }

  res.json({ serverTime: new Date(), ...results });
});

/**
 * POST /api/sync/upload-queued-image
 * Multipart upload used when a product photo was taken offline and queued;
 * the client calls this once connectivity returns, then pushes the product
 * update with the returned URL.
 */
export const uploadQueuedImage = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error("No image file provided");
  }
  const result = await uploadBufferToCloudinary(req.file.buffer, {
    folder: `hardware-saas/${req.user.storeId}/products`,
  });
  res.json({ imageUrl: result.secure_url, imagePublicId: result.public_id });
});