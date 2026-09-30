import asyncHandler from "express-async-handler";
import Supplier from "../models/Supplier.js";
import { logAction } from "../utils/audit.js";

// GET /api/suppliers
export const listSuppliers = asyncHandler(async (req, res) => {
  const suppliers = await Supplier.find({ storeId: req.user.storeId, isDeleted: false }).sort({ name: 1 });
  res.json(suppliers);
});

// POST /api/suppliers
export const createSupplier = asyncHandler(async (req, res) => {
  const { name, phone, email, address, notes, clientId } = req.body;
  if (!name) {
    res.status(400);
    throw new Error("Supplier name is required");
  }

  if (clientId) {
    const existing = await Supplier.findOne({ storeId: req.user.storeId, clientId });
    if (existing) return res.status(200).json(existing);
  }

  const supplier = await Supplier.create({
    storeId: req.user.storeId,
    name,
    phone,
    email,
    address,
    notes,
    clientId,
    createdBy: req.user.id,
    updatedBy: req.user.id,
  });

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "supplier.create",
    entityType: "Supplier",
    entityId: supplier._id,
    after: supplier.toObject(),
  });

  res.status(201).json(supplier);
});

// PUT /api/suppliers/:id
export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findOne({ _id: req.params.id, storeId: req.user.storeId });
  if (!supplier) {
    res.status(404);
    throw new Error("Supplier not found");
  }

  const before = supplier.toObject();
  const editable = ["name", "phone", "email", "address", "notes", "isActive"];
  for (const field of editable) {
    if (req.body[field] !== undefined) supplier[field] = req.body[field];
  }
  supplier.updatedBy = req.user.id;
  await supplier.save();

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "supplier.update",
    entityType: "Supplier",
    entityId: supplier._id,
    before,
    after: supplier.toObject(),
  });

  res.json(supplier);
});

// DELETE /api/suppliers/:id
export const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findOne({ _id: req.params.id, storeId: req.user.storeId });
  if (!supplier) {
    res.status(404);
    throw new Error("Supplier not found");
  }
  supplier.isDeleted = true;
  supplier.updatedBy = req.user.id;
  await supplier.save();

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "supplier.delete",
    entityType: "Supplier",
    entityId: supplier._id,
  });

  res.status(204).send();
});
