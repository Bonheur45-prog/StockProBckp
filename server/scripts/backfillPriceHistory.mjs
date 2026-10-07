// One-time (and safe to re-run) backfill of PRICE HISTORY baselines.
//
// Price history can only record changes from the moment it is switched on.
// For every product that already exists at that moment, this writes ONE
// "baseline" row per price field (costPrice, sellPrice) holding the price it
// has RIGHT NOW, stamped with the time this script runs. That gives the
// lookup ("what was this product's cost at time X?") a starting point.
//
// What this does NOT do — and cannot: it does not invent history. For any
// moment BEFORE the baseline row, the answer is still "unknown", and Profit
// & Loss labels those sales as an estimate. Do not backdate these rows.
//
// Idempotent: a product+field that already has ANY history row is skipped,
// so re-running (or running after some products were created post-deploy)
// never duplicates anything.
//
// Usage (run from server/, ideally right after deploying the version that
// introduces price history):
//   node scripts/backfillPriceHistory.mjs --dry-run   # show what WOULD be written
//   node scripts/backfillPriceHistory.mjs             # write it
//
// Requires MONGO_URI in the environment, same as the running server.

import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../src/models/Product.js";
import PriceHistory, { PRICE_FIELDS } from "../src/models/PriceHistory.js";

dotenv.config();

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set in the environment.");
    process.exit(1);
  }

  await mongoose.connect(uri);

  const runAt = new Date();
  let productsSeen = 0;
  let rowsToWrite = 0;
  let rowsWritten = 0;
  let rowsSkipped = 0;

  // Every product, including soft-deleted ones: past sales of a since-removed
  // product still need a cost lookup.
  for await (const product of Product.find({}).cursor()) {
    productsSeen += 1;

    for (const field of PRICE_FIELDS) {
      const alreadyTracked = await PriceHistory.exists({ storeId: product.storeId, productId: product._id, field });
      if (alreadyTracked) {
        rowsSkipped += 1;
        continue;
      }

      rowsToWrite += 1;
      if (dryRun) continue;

      try {
        await PriceHistory.create({
          storeId: product.storeId,
          productId: product._id,
          productClientId: product.clientId,
          field,
          oldValue: null,
          newValue: Number(product[field]) || 0,
          kind: "baseline",
          changedAt: runAt,
          // Deterministic id: even a concurrent second run can't double-insert.
          clientId: `baseline:${product._id}:${field}`,
        });
        rowsWritten += 1;
      } catch (err) {
        if (err.code === 11000) {
          rowsSkipped += 1; // another run got there first
        } else {
          throw err;
        }
      }
    }
  }

  console.log(
    dryRun
      ? `[dry run] ${productsSeen} products scanned — would write ${rowsToWrite} baseline rows, ${rowsSkipped} already tracked.`
      : `${productsSeen} products scanned — wrote ${rowsWritten} baseline rows, ${rowsSkipped} already tracked.`
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
