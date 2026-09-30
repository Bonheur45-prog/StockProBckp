import asyncHandler from "express-async-handler";
import Store from "../models/Store.js";
import { logAction } from "../utils/audit.js";

// PUT /api/store  (owner/manager only, enforced in route)
export const updateStore = asyncHandler(async (req, res) => {
  const store = await Store.findById(req.user.storeId);
  if (!store) {
    res.status(404);
    throw new Error("Store not found");
  }

  const before = store.toObject();

  const editable = ["name", "businessType", "tin", "address", "phone", "currency", "skuPrefix", "lowStockThresholdDefault", "logoUrl", "logoPublicId"];
  for (const field of editable) {
    if (req.body[field] !== undefined && req.body[field] !== "") store[field] = req.body[field];
  }

  await store.save();

  await logAction({
    storeId: store._id,
    userId: req.user.id,
    action: "store.update",
    entityType: "Store",
    entityId: store._id,
    before,
    after: store.toObject(),
  });

  res.json(store);
});