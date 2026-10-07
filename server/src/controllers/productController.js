import asyncHandler from "express-async-handler";
import Product from "../models/Product.js";
import Store from "../models/Store.js";
import { uploadBufferToCloudinary } from "../config/cloudinary.js";
import { logAction } from "../utils/audit.js";
import { assertNoDuplicateCodes } from "../utils/productCodes.js";
import { recordPriceChanges } from "../utils/priceHistory.js";

// GET /api/products?search=&category=&lowStock=true&page=&limit=
export const listProducts = asyncHandler(async (req, res) => {
  const { search, category, lowStock, page = 1, limit = 50 } = req.query;

  const query = { storeId: req.user.storeId, isDeleted: false };
  if (category) query.category = category;
  if (search) query.$text = { $search: search };

  let productsQuery = Product.find(query).sort({ name: 1 });

  const skip = (Number(page) - 1) * Number(limit);
  const [items, total, store] = await Promise.all([
    productsQuery.skip(skip).limit(Number(limit)),
    Product.countDocuments(query),
    lowStock === "true" ? Store.findById(req.user.storeId, "lowStockThresholdDefault") : null,
  ]);

  const filtered =
    lowStock === "true"
      ? items.filter((p) => p.quantityOnHand <= (p.lowStockThreshold ?? store?.lowStockThresholdDefault ?? 5))
      : items;

  res.json({ items: filtered, total, page: Number(page), limit: Number(limit) });
});

// GET /api/products/:id
export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, storeId: req.user.storeId, isDeleted: false });
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }
  res.json(product);
});

// POST /api/products
export const createProduct = asyncHandler(async (req, res) => {
  const { name, sku, barcode, category, unit, costPrice, sellPrice, quantityOnHand, lowStockThreshold, clientId } =
    req.body;

  if (!name || sellPrice === undefined) {
    res.status(400);
    throw new Error("name and sellPrice are required");
  }

  await assertNoDuplicateCodes(req.user.storeId, { barcode, sku }, clientId);

  let imageUrl, imagePublicId;
  if (req.file) {
    const result = await uploadBufferToCloudinary(req.file.buffer, { folder: `hardware-saas/${req.user.storeId}/products` });
    imageUrl = result.secure_url;
    imagePublicId = result.public_id;
  }

  const product = await Product.create({
    storeId: req.user.storeId,
    name,
    sku,
    barcode,
    category,
    unit,
    costPrice: Number(costPrice) || 0,
    sellPrice: Number(sellPrice),
    quantityOnHand: Number(quantityOnHand) || 0,
    lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : null,
    imageUrl,
    imagePublicId,
    clientId,
    createdBy: req.user.id,
    updatedBy: req.user.id,
  });

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "product.create",
    entityType: "Product",
    entityId: product._id,
    after: product.toObject(),
  });

  // Price history: record the prices the product started with. The product
  // is already saved, so a failure here must not fail the request — it is
  // logged loudly instead (same stance as logAction above).
  try {
    await recordPriceChanges({ storeId: req.user.storeId, product, after: product.toObject(), userId: req.user.id, kind: "created" });
  } catch (err) {
    console.error("[priceHistory] failed to record initial prices:", err.message);
  }

  res.status(201).json(product);
});

// PUT /api/products/:id
export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, storeId: req.user.storeId });
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  const before = product.toObject();

  await assertNoDuplicateCodes(
    req.user.storeId,
    { barcode: req.body.barcode ?? product.barcode, sku: req.body.sku ?? product.sku },
    product.clientId
  );

  const editable = ["name", "sku", "barcode", "category", "unit", "costPrice", "sellPrice", "lowStockThreshold", "isActive"];
  for (const field of editable) {
    if (req.body[field] !== undefined) product[field] = req.body[field];
  }

  if (req.file) {
    const result = await uploadBufferToCloudinary(req.file.buffer, { folder: `hardware-saas/${req.user.storeId}/products` });
    product.imageUrl = result.secure_url;
    product.imagePublicId = result.public_id;
  }

  product.updatedBy = req.user.id;
  await product.save();

  // Price history: compares the pre-edit snapshot (`before`) with the saved
  // product and writes a row ONLY for a costPrice/sellPrice that actually
  // changed — renaming a product or re-saving the same price logs nothing.
  try {
    await recordPriceChanges({ storeId: req.user.storeId, product, before, after: product.toObject(), userId: req.user.id, kind: "change" });
  } catch (err) {
    console.error("[priceHistory] failed to record price change:", err.message);
  }

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "product.update",
    entityType: "Product",
    entityId: product._id,
    before,
    after: product.toObject(),
  });

  res.json(product);
});

// DELETE /api/products/:id  (soft delete so sync can propagate it)
export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findOne({ _id: req.params.id, storeId: req.user.storeId });
  if (!product) {
    res.status(404);
    throw new Error("Product not found");
  }

  product.isDeleted = true;
  product.updatedBy = req.user.id;
  await product.save();

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "product.delete",
    entityType: "Product",
    entityId: product._id,
  });

  res.status(204).send();
});