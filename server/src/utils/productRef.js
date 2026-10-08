import mongoose from "mongoose";
import Product from "../models/Product.js";

/**
 * Offline-created records (sales, stock movements) can reference a product
 * by its client-generated UUID if the product itself hadn't synced and
 * received a real server _id yet at the moment they were created. Without
 * this, such a reference would fail to resolve on the server — the push
 * would error out and the record would sit "pending" forever with no
 * visible explanation.
 *
 * This resolves a batch of refs (each either a Mongo ObjectId string or a
 * clientId UUID) to their Product documents in one pair of queries, keyed
 * by whatever the original ref string was — so callers can keep using
 * `map.get(item.productId)` unchanged regardless of which form it's in.
 *
 * Soft-deleted products are EXCLUDED by default, so new work (restocking,
 * ordering) can't be pointed at a product the owner has removed. Pass
 * { includeDeleted: true } where the record describes something that has
 * ALREADY happened and must still be recorded: a sale rung up offline before
 * the delete synced, or the price history of a product deleted afterwards.
 * (isDeleted is matched with $ne: true so older documents that predate the
 * field are still found.)
 */
export async function resolveProductRefs(storeId, refs, session, { includeDeleted = false } = {}) {
  const live = includeDeleted ? {} : { isDeleted: { $ne: true } };
  const unique = [...new Set(refs.filter(Boolean))];
  const objectIdRefs = unique.filter((r) => mongoose.Types.ObjectId.isValid(r));
  const clientIdRefs = unique.filter((r) => !mongoose.Types.ObjectId.isValid(r));

  const [byObjectId, byClientId] = await Promise.all([
    objectIdRefs.length
      ? Product.find({ _id: { $in: objectIdRefs }, storeId, ...live }).session(session || undefined)
      : [],
    clientIdRefs.length
      ? Product.find({ clientId: { $in: clientIdRefs }, storeId, ...live }).session(session || undefined)
      : [],
  ]);

  const map = new Map();
  for (const p of byObjectId) map.set(p._id.toString(), p);
  for (const p of byClientId) if (p.clientId) map.set(p.clientId, p);
  return map;
}