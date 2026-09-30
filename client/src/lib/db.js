import Dexie from "dexie";

/**
 * Local-first database. Every table is keyed by `clientId` (a UUID
 * generated on the device), never by the Mongo `_id` — that's what lets
 * the app create products, stock movements and sales while fully offline
 * and reconcile with the server later without collisions.
 *
 * `dirty: 1` marks a record with local changes not yet confirmed synced.
 * The sync engine pushes everything with dirty=1, and clears the flag
 * once the server has accepted it.
 */
export const db = new Dexie("hardwareSaasDB");

// v1: initial schema (products, sales, stockMovements, meta)
db.version(1).stores({
  products: "clientId, id, storeId, name, sku, barcode, category, dirty, isDeleted, updatedAt",
  sales: "clientId, id, storeId, dirty, occurredAt, status",
  stockMovements: "clientId, id, storeId, productId, dirty, createdAt",
  meta: "key",
});

// v2: adds creditPayments (customer credit accounts). Bumping the version
// is required — IndexedDB only picks up new object stores when the version
// number increases, even if the code already references the new table.
db.version(2).stores({
  products: "clientId, id, storeId, name, sku, barcode, category, dirty, isDeleted, updatedAt",
  sales: "clientId, id, storeId, dirty, occurredAt, status",
  stockMovements: "clientId, id, storeId, productId, dirty, createdAt",
  creditPayments: "clientId, id, storeId, customerName, customerPhone, dirty, createdAt",
  meta: "key",
});

// v3: adds suppliers, purchaseOrders, and poReceipts (queued "receive stock
// against a PO" actions, since receiving is a mutation on an existing
// record rather than a simple new-record creation like everything else).
db.version(3).stores({
  products: "clientId, id, storeId, name, sku, barcode, category, dirty, isDeleted, updatedAt",
  sales: "clientId, id, storeId, dirty, occurredAt, status",
  stockMovements: "clientId, id, storeId, productId, dirty, createdAt",
  creditPayments: "clientId, id, storeId, customerName, customerPhone, dirty, createdAt",
  suppliers: "clientId, id, storeId, name, dirty, isDeleted",
  purchaseOrders: "clientId, id, storeId, status, dirty, createdAt",
  poReceipts: "clientId, purchaseOrderId, dirty, createdAt",
  meta: "key",
});

export async function getMeta(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await db.meta.put({ key, value });
}

export async function clearLocalData() {
  await Promise.all([
    db.products.clear(),
    db.sales.clear(),
    db.stockMovements.clear(),
    db.creditPayments.clear(),
    db.suppliers.clear(),
    db.purchaseOrders.clear(),
    db.poReceipts.clear(),
    db.meta.clear(),
  ]);
}
