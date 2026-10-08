// READ-ONLY check of price-history coverage. Writes nothing.
//
// For every product + price field (costPrice / sellPrice) it looks at the
// EARLIEST history row and reports how that product's history begins:
//   baseline  — starting row written by backfillPriceHistory.mjs   (complete)
//   created   — row written when the product was created in the app (complete)
//   change    — the earliest row is an EDIT, so what the price was
//               BEFORE that edit is unknown
//   (none)    — a product price with no history row at all
//
// Usage (from server/):   node scripts/checkPriceHistory.mjs
// Requires MONGO_URI in the environment, same as the server.

import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../src/models/Product.js";
import PriceHistory, { PRICE_FIELDS } from "../src/models/PriceHistory.js";

dotenv.config();

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is not set in the environment.");
    process.exit(1);
  }
  await mongoose.connect(uri);

  const totalRows = await PriceHistory.countDocuments({});
  const products = await Product.countDocuments({});

  // Earliest row per product + field.
  const earliest = await PriceHistory.aggregate([
    { $sort: { changedAt: 1, createdAt: 1 } },
    { $group: { _id: { productId: "$productId", field: "$field" }, firstKind: { $first: "$kind" } } },
  ]);

  const byKind = {};
  for (const row of earliest) byKind[row.firstKind] = (byKind[row.firstKind] || 0) + 1;

  const expected = products * PRICE_FIELDS.length;
  const covered = earliest.length;

  console.log(`Products: ${products}  ->  expected product prices: ${expected}`);
  console.log(`Total history rows: ${totalRows}`);
  console.log(`Product prices with at least one history row: ${covered}`);
  console.log(`Product prices with NO history row: ${Math.max(0, expected - covered)}`);
  console.log("How each tracked price's history begins:");
  for (const kind of ["baseline", "created", "change"]) {
    console.log(`  ${kind.padEnd(9)} ${byKind[kind] || 0}`);
  }
  if ((byKind.change || 0) > 0) {
    console.log(`\nNote: ${byKind.change} price(s) begin with an edit, so their value before that edit is unknown.`);
    console.log("Old sales of those products will be costed with the labelled estimate.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Check failed:", err.message);
  process.exit(1);
});
