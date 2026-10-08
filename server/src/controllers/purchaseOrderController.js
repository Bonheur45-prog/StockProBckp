import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import PurchaseOrder from "../models/PurchaseOrder.js";
import Supplier from "../models/Supplier.js";
import StockMovement from "../models/StockMovement.js";
import { logAction } from "../utils/audit.js";
import { resolveProductRefs } from "../utils/productRef.js";
import { applyStockMovement } from "./stockController.js";

/**
 * The set of PurchaseOrder fields editable after creation — shared by the
 * direct PUT route and the sync push's create-or-update path, so the two
 * can't drift apart on what "editing a PO" means. Deliberately excludes
 * items/quantityReceived and supplierId — see performCreatePurchaseOrder's
 * docstring for why items is excluded; supplierId simply isn't editable
 * anywhere in the app today (supplierName is the snapshot that survives a
 * supplier being renamed or removed, per the model's own comment).
 */
const PO_EDITABLE_FIELDS = ["status", "notes", "expectedDate", "supplierName"];

/**
 * Resolves a purchase order reference that may be a real Mongo ObjectId or
 * a client-generated UUID — the same "not synced yet" scenario handled for
 * products. A PO can be created offline and received against (also
 * offline) before it's ever had a chance to sync and receive a real
 * server _id, so the receive action must accept either form.
 */
async function resolvePurchaseOrder(storeId, orderId) {
  if (mongoose.Types.ObjectId.isValid(orderId)) {
    const byId = await PurchaseOrder.findOne({ _id: orderId, storeId });
    if (byId) return byId;
  }
  return PurchaseOrder.findOne({ storeId, clientId: orderId });
}

/**
 * Resolves a supplier reference the same way. This one matters even more
 * than the read-only lookups above: supplierId is a strict ObjectId field
 * on the schema, so passing an unresolved client UUID through to
 * PurchaseOrder.create() wouldn't just fail to find a match — it would
 * throw a hard Mongoose CastError and the sync push would never succeed.
 */
async function resolveSupplierId(storeId, supplierId) {
  if (!supplierId) return undefined;
  if (mongoose.Types.ObjectId.isValid(supplierId)) {
    const byId = await Supplier.findOne({ _id: supplierId, storeId });
    if (byId) return byId._id;
  }
  const byClientId = await Supplier.findOne({ storeId, clientId: supplierId });
  return byClientId?._id; // undefined if truly unresolvable — PO still saves, just without a linked supplier
}

/**
 * Core PO-creation logic, shared by the direct route and the offline sync
 * push handler, so a PO created offline goes through exactly the same
 * product/supplier resolution as one created online.
 *
 * Idempotent on clientId — but "idempotent" here means create-or-update
 * (matching Product/Supplier's last-write-wins pattern), not
 * create-or-return-unchanged. It used to be the latter: any edit to an
 * already-synced PO (e.g. updatePurchaseOrderStatus, used by "Cancel")
 * wrote locally and marked the record dirty, then got silently dropped
 * server-side on the next push, since the existing-clientId branch just
 * returned the current document as-is. A cancelled PO would show as
 * cancelled forever on the device that cancelled it, and as whatever it
 * was before on the server and every other device — no error, no retry,
 * since the server genuinely never received the change.
 *
 * items/quantityReceived is deliberately EXCLUDED from the update below,
 * same reasoning as quantityOnHand being excluded from Product's own
 * update: it has its own dedicated, idempotent mutation path
 * (performReceivePurchaseOrder, via the poReceipts sync category) that
 * must stay the sole writer of that field. The client's local record for
 * an already-synced PO gets marked dirty and re-enters this generic
 * purchaseOrders category too whenever it's received against (same
 * underlying db.purchaseOrders row) — if this update branch also applied
 * items from that payload, both this path and the receiving path would
 * apply the same receipt, reintroducing the exact double-decrement shape
 * already fixed elsewhere this session. Editing items directly (as
 * opposed to receiving against them) isn't a feature the client exposes
 * today; if that's ever added, it needs its own careful pass, not a
 * silent extension of this one.
 */
export async function performCreatePurchaseOrder(storeId, userId, payload) {
  const { supplierId, supplierName, items, notes, expectedDate, status, clientId } = payload;

  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error("At least one line item is required"), { statusCode: 400 });
  }

  if (clientId) {
    const existing = await PurchaseOrder.findOne({ storeId, clientId });
    if (existing) {
      const clientUpdatedAt = payload.updatedAt ? new Date(payload.updatedAt) : null;
      if (clientUpdatedAt && clientUpdatedAt > existing.updatedAt) {
        for (const field of PO_EDITABLE_FIELDS) {
          if (payload[field] !== undefined) existing[field] = payload[field];
        }
        // items intentionally omitted — see docstring above.
        existing.updatedBy = userId;
        await existing.save();
      }
      return existing;
    }
  }

  const productRefs = items.map((i) => i.productId);
  const productMap = await resolveProductRefs(storeId, productRefs);

  const resolvedItems = items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) throw Object.assign(new Error(`A product on this order wasn't found — it may have been removed from your catalog (${item.name || item.productId})`), { statusCode: 404 });
    return {
      productId: product._id,
      name: product.name,
      quantityOrdered: Number(item.quantityOrdered),
      quantityReceived: 0,
      unitCost: Number(item.unitCost) || 0,
    };
  });

  const resolvedSupplierId = await resolveSupplierId(storeId, supplierId);

  const order = await PurchaseOrder.create({
    storeId,
    supplierId: resolvedSupplierId,
    supplierName: supplierName || "",
    items: resolvedItems,
    notes,
    expectedDate,
    status: status || "draft",
    clientId,
    createdBy: userId,
    updatedBy: userId,
  });

  await logAction({
    storeId, userId, action: "purchase-order.create", entityType: "PurchaseOrder", entityId: order._id, after: order.toObject(),
  });

  return order;
}

// GET /api/purchase-orders?status=
export const listPurchaseOrders = asyncHandler(async (req, res) => {
  const query = { storeId: req.user.storeId };
  if (req.query.status) query.status = req.query.status;
  const orders = await PurchaseOrder.find(query).sort({ createdAt: -1 });
  res.json(orders);
});

// GET /api/purchase-orders/:id
export const getPurchaseOrder = asyncHandler(async (req, res) => {
  const order = await resolvePurchaseOrder(req.user.storeId, req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Purchase order not found");
  }
  res.json(order);
});

// POST /api/purchase-orders
// body: { supplierId?, supplierName, items: [{ productId, quantityOrdered, unitCost }], notes?, expectedDate?, status? }
export const createPurchaseOrder = asyncHandler(async (req, res) => {
  try {
    const order = await performCreatePurchaseOrder(req.user.storeId, req.user.id, req.body);
    res.status(201).json(order);
  } catch (err) {
    res.status(err.statusCode || 500);
    throw err;
  }
});

// PUT /api/purchase-orders/:id  — edit status/notes/expectedDate (not line items once ordered)
export const updatePurchaseOrder = asyncHandler(async (req, res) => {
  const order = await resolvePurchaseOrder(req.user.storeId, req.params.id);
  if (!order) {
    res.status(404);
    throw new Error("Purchase order not found");
  }

  const before = order.toObject();
  for (const field of PO_EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) order[field] = req.body[field];
  }
  order.updatedBy = req.user.id;
  await order.save();

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "purchase-order.update",
    entityType: "PurchaseOrder",
    entityId: order._id,
    before,
    after: order.toObject(),
  });

  res.json(order);
});

/**
 * Core "receive stock against a PO" logic, reused by the direct route and
 * the offline sync push handler. Idempotent per call via each movement's
 * own clientId (set by the caller) — receiving twice with the same
 * clientId won't double-count stock.
 *
 * Retries the whole read-modify-write cycle under optimistic concurrency
 * (matched on updatedAt) because two receipts landing on the same PO at
 * nearly the same time both used to read the same starting
 * quantityReceived, both compute up to the full remaining amount, and
 * whichever saved last would silently overwrite the other's update —
 * stock correctly ends up incremented twice (applyStockMovement's own
 * atomic update handles that part fine), but the order's own bookkeeping
 * under-counts, since the loser's save never happened.
 */
export async function performReceivePurchaseOrder(storeId, userId, orderId, payload) {
  const { items } = payload; // [{ productId, quantityReceived, clientId? }]
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error("At least one item to receive is required"), { statusCode: 400 });
  }

  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const order = await resolvePurchaseOrder(storeId, orderId);
    if (!order) throw Object.assign(new Error("Purchase order not found"), { statusCode: 404 });
    if (order.status === "cancelled") {
      throw Object.assign(new Error("This order was cancelled"), { statusCode: 400 });
    }

    const seenUpdatedAt = order.updatedAt;

    for (const receipt of items) {
      const quantity = Number(receipt.quantityReceived);
      if (!quantity || quantity <= 0) continue;

      const line = order.items.find((i) => i.productId.toString() === receipt.productId);
      if (!line) throw Object.assign(new Error(`No such line item on this order: ${receipt.productId}`), { statusCode: 400 });

      // Guard against double-counting stock on a retried sync push (a
      // genuine client retry) — AND against double-counting on our OWN
      // internal retry below, if an earlier attempt in this same call
      // already applied the stock movement but then lost the optimistic-
      // concurrency race to save the order. In either case, don't touch
      // stock again — but DO still credit it to quantityReceived if this
      // attempt's fresh read of the order doesn't yet reflect it (using
      // the amount actually recorded on the existing movement, not
      // re-deriving it from "remaining", which would be wrong once
      // something's already been applied).
      let applied;
      if (receipt.clientId) {
        const existing = await StockMovement.findOne({ storeId, clientId: receipt.clientId });
        if (existing) applied = existing.quantityChange;
      }
      if (applied === undefined) {
        const remaining = line.quantityOrdered - line.quantityReceived;
        applied = Math.min(quantity, remaining);
        if (applied <= 0) continue;
        await applyStockMovement({
          storeId,
          productId: line.productId.toString(),
          type: "restock",
          quantityChange: applied,
          reason: `Received on PO${order.supplierName ? ` from ${order.supplierName}` : ""}`,
          userId,
          clientId: receipt.clientId,
        });
      }

      line.quantityReceived += applied;
    }

    const allReceived = order.items.every((i) => i.quantityReceived >= i.quantityOrdered);
    const anyReceived = order.items.some((i) => i.quantityReceived > 0);
    order.status = allReceived ? "received" : anyReceived ? "partially_received" : order.status;
    order.updatedBy = userId;

    // Only commit if nobody else has changed this order since the read at
    // the top of this attempt. If someone else's concurrent receive (or
    // edit) landed in between, this order's in-memory copy here is stale
    // — re-read and retry rather than blindly overwriting their update.
    const result = await PurchaseOrder.updateOne(
      { _id: order._id, storeId, updatedAt: seenUpdatedAt },
      { $set: { items: order.toObject().items, status: order.status, updatedBy: userId, updatedAt: new Date() } }
    );

    if (result.matchedCount > 0) {
      await logAction({
        storeId, userId, action: "purchase-order.receive", entityType: "PurchaseOrder", entityId: order._id, after: order.toObject(),
      });
      return order;
    }
    // Someone else updated this order between our read and write above — retry.
  }

  throw Object.assign(
    new Error("This purchase order is being updated by someone else right now — please try again."),
    { statusCode: 409 }
  );
}

// POST /api/purchase-orders/:id/receive
export const receivePurchaseOrder = asyncHandler(async (req, res) => {
  try {
    const order = await performReceivePurchaseOrder(req.user.storeId, req.user.id, req.params.id, req.body);
    res.json(order);
  } catch (err) {
    res.status(err.statusCode || 500);
    throw err;
  }
});