import asyncHandler from "express-async-handler";
import Store from "../models/Store.js";
import Product from "../models/Product.js";

/**
 * Public product lookup — no auth, reachable by anyone who scans a
 * printed QR label. Deliberately returns a narrow field set: no cost
 * price, no exact stock count (just in/out of stock), nothing that
 * exposes margin or inventory depth to a stranger. Scoped by storeSlug so
 * the same barcode value in two different stores can never cross-resolve.
 */
export const getPublicProduct = asyncHandler(async (req, res) => {
  const { storeSlug, barcode } = req.params;

  // One identical answer whether the store or the product is missing, so the
  // public endpoint can't be used to find out which store codes exist.
  const notFound = () => {
    res.status(404);
    throw new Error("Product not found");
  };

  const store = await Store.findOne({ slug: String(storeSlug).toLowerCase() });
  if (!store) notFound();

  const product = await Product.findOne({ storeId: store._id, barcode: String(barcode), isDeleted: { $ne: true } });
  if (!product) notFound();

  res.json({
    product: {
      name: product.name,
      category: product.category || "",
      unit: product.unit || "pcs",
      sellPrice: product.sellPrice,
      imageUrl: product.imageUrl || null,
      inStock: product.quantityOnHand > 0,
    },
    store: {
      name: store.name,
      phone: store.phone || "",
      logoUrl: store.logoUrl || null,
    },
  });
});