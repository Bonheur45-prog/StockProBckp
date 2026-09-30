import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import * as repo from "../repo.js";

/**
 * Same bug and same reasoning as the "does not mark the product dirty"
 * tests in createSale.test.js and receivePurchaseOrder.test.js — restock
 * and adjustStock share the same product-write pattern
 * (writeMovementAndAdjustStock), so they needed the same fix.
 */

const STORE_A = "storeA000000000000000001";

function loginAs(storeId, userId = "user1", role = "cashier") {
  localStorage.setItem("user", JSON.stringify({ id: userId, storeId, name: "Test User", role }));
}

beforeEach(async () => {
  await db.products.clear();
  await db.stockMovements.clear();
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
});

describe("restock / adjustStock — product dirty flag", () => {
  it("restock bumps quantity but does not mark the product dirty", async () => {
    await repo.restock("prod1", 5, "Delivery");
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(15);
    expect(product.dirty).toBeFalsy();
  });

  it("adjustStock changes quantity but does not mark the product dirty", async () => {
    await repo.adjustStock("prod1", -3, "Damaged stock");
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(7);
    expect(product.dirty).toBeFalsy();
  });

  it("still queues the movement itself as dirty (that part does need to sync)", async () => {
    await repo.restock("prod1", 5, "Delivery");
    const movements = await db.stockMovements.toArray();
    expect(movements).toHaveLength(1);
    expect(movements[0].dirty).toBe(1);
  });

  it("preserves an existing genuine pending product edit instead of clearing it", async () => {
    await db.products.update("prod1", { name: "Hammer (renamed, unsynced)", dirty: 1 });
    await repo.restock("prod1", 5, "Delivery");
    const product = await db.products.get("prod1");
    expect(product.dirty).toBe(1);
    expect(product.quantityOnHand).toBe(15);
  });
});
