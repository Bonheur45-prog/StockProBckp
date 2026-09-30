import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import * as repo from "../repo.js";

/**
 * Regression test for the PO-receiving bug: receivePurchaseOrder() used to
 * queue both a local StockMovement AND a poReceipts entry sharing one
 * clientId on purpose, so the server's StockMovement idempotency check
 * would treat the poReceipts entry as a no-op and avoid double-applying
 * stock. But both were pushed in the same sync request, stockMovements
 * processed first — so that shared clientId always already existed by the
 * time the poReceipts handler looked for it, and its "already applied,
 * skip" branch fired before ever incrementing the PO's own
 * quantityReceived. Net effect: stock moved correctly, but the PO stayed
 * stuck at 0 received forever, on every single receipt.
 *
 * This test only exercises the local write path (no server involved), so
 * it can't reproduce the actual clientId collision — that lived entirely
 * in the shape of what got queued. What it asserts instead is the fix's
 * precondition: nothing is queued locally anymore that could collide with
 * itself, and every line item's outgoing clientId is unique — the same
 * property a live sync-push trace (or your own hands-on pass) can confirm
 * end to end.
 */

const STORE_A = "storeA000000000000000001";

function loginAs(storeId, userId = "user1", role = "owner") {
  localStorage.setItem("user", JSON.stringify({ id: userId, storeId, name: "Test User", role }));
}

beforeEach(async () => {
  await db.products.clear();
  await db.purchaseOrders.clear();
  await db.stockMovements.clear();
  await db.poReceipts.clear();
  localStorage.clear();
  loginAs(STORE_A);
  await db.products.put({
    clientId: "prod1",
    storeId: STORE_A,
    name: "Hammer",
    sku: "SKU-1",
    quantityOnHand: 10,
    sellPrice: 5000,
    isDeleted: false,
    dirty: 0,
    updatedAt: new Date().toISOString(),
  });
  await db.purchaseOrders.put({
    clientId: "po1",
    storeId: STORE_A,
    supplierName: "Test Supplier",
    items: [{ productId: "prod1", name: "Hammer", quantityOrdered: 20, quantityReceived: 0, unitCost: 3000 }],
    status: "ordered",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    dirty: 0,
  });
});

describe("receivePurchaseOrder — no redundant local StockMovement queued", () => {
  it("bumps product stock", async () => {
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 8 }]);
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(18); // 10 + 8
  });

  it("does not mark the product dirty (same reasoning as createSale — see its test file)", async () => {
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 8 }]);
    const product = await db.products.get("prod1");
    expect(product.dirty).toBeFalsy();
  });

  it("preserves an existing genuine pending edit on the product instead of clearing it", async () => {
    await db.products.update("prod1", { name: "Hammer (renamed, unsynced)", dirty: 1 });
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 8 }]);
    const product = await db.products.get("prod1");
    expect(product.dirty).toBe(1);
    expect(product.quantityOnHand).toBe(18);
  });

  it("queues no local StockMovement for the receipt — only a poReceipts entry", async () => {
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 8 }]);
    expect(await db.stockMovements.count()).toBe(0);
    const receipts = await db.poReceipts.toArray();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].items[0].quantityReceived).toBe(8);
  });

  it("updates the PO's own quantityReceived and status locally", async () => {
    const updated = await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 8 }]);
    expect(updated.items[0].quantityReceived).toBe(8);
    expect(updated.status).toBe("partially_received");
  });

  it("flips to received once the full ordered quantity is in", async () => {
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 20 }]);
    const order = await repo.getPurchaseOrder("po1");
    expect(order.items[0].quantityReceived).toBe(20);
    expect(order.status).toBe("received");
  });

  it("gives every queued receipt line a unique clientId (the idempotency key sent to the server)", async () => {
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 5 }]);
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 5 }]);
    const receipts = await db.poReceipts.toArray();
    const ids = receipts.flatMap((r) => r.items.map((i) => i.clientId));
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("never receives more than what remains on the order line", async () => {
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 15 }]);
    await repo.receivePurchaseOrder("po1", [{ productId: "prod1", quantityReceived: 15 }]); // only 5 remain
    const order = await repo.getPurchaseOrder("po1");
    expect(order.items[0].quantityReceived).toBe(20); // capped at quantityOrdered, not 30
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(30); // 10 + 15 + 5, not 10 + 15 + 15
  });
});
