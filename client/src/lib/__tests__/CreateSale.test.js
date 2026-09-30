import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import * as repo from "../repo.js";

/**
 * Regression test for a real production bug: createSale() used to write
 * both a decremented product AND a separate StockMovement(type="sale")
 * record, both queued as dirty. The server processed the sale and the
 * queued movement independently, decrementing stock twice for one sale.
 *
 * This test exercises the actual local write path (no server involved —
 * sync is mocked in setup.js) and asserts that a single sale produces
 * exactly one stock change and queues no redundant local movement.
 */

const STORE_A = "storeA000000000000000001";

function loginAs(storeId, userId = "user1") {
  localStorage.setItem("user", JSON.stringify({ id: userId, storeId, name: "Test User", role: "owner" }));
}

beforeEach(async () => {
  await db.products.clear();
  await db.sales.clear();
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

describe("createSale — stock is decremented exactly once", () => {
  it("decrements product.quantityOnHand by exactly the sold quantity", async () => {
    await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }] });
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(8); // 10 - 2, not 10 - 4
  });

  it("queues no local StockMovement for the sale's line items", async () => {
    await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }] });
    const movements = await db.stockMovements.toArray();
    expect(movements).toHaveLength(0);
  });

  /**
   * Regression test for a second, more severe bug found while building the
   * stuck-sync-record recovery feature: the product write here used to
   * force dirty:1 unconditionally. Combined with the sync-push role gate
   * (any dirty entry in the "products" category is rejected for a
   * cashier), this meant every cashier sale ever made permanently
   * role-blocked its own product's dirty flag — which also means that
   * product would never receive any future catalog update via pull again
   * (pull skips anything locally dirty), forever, silently, after a
   * cashier's very first sale. The server never reads quantityOnHand from
   * a product push anyway, so there was never a reason for this to be
   * dirty in the first place.
   */
  it("does not mark the product dirty for a plain sale (nothing here actually needs to sync)", async () => {
    await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }] });
    const product = await db.products.get("prod1");
    expect(product.dirty).toBeFalsy();
  });

  it("preserves an existing genuine pending edit on the product instead of clearing it", async () => {
    await db.products.update("prod1", { name: "Hammer (renamed, unsynced)", dirty: 1 });
    await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }] });
    const product = await db.products.get("prod1");
    expect(product.dirty).toBe(1); // the pending rename must still be queued to sync
    expect(product.quantityOnHand).toBe(8); // and the sale still applied correctly
  });

  it("queues exactly one dirty sale record with the correct total", async () => {
    await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }], discount: 500 });
    const sales = await db.sales.toArray();
    expect(sales).toHaveLength(1);
    expect(sales[0].dirty).toBe(1);
    expect(sales[0].subtotal).toBe(10000);
    expect(sales[0].total).toBe(9500);
  });

  it("still refuses to sell more than is on hand", async () => {
    await expect(repo.createSale({ items: [{ productId: "prod1", quantity: 11 }] })).rejects.toThrow(/Not enough stock/);
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(10); // unchanged
  });

  it("handles multiple sales sequentially without drift", async () => {
    await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }] });
    await repo.createSale({ items: [{ productId: "prod1", quantity: 3 }] });
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(5); // 10 - 2 - 3
    expect(await db.stockMovements.count()).toBe(0);
  });
});

/**
 * Regression test for a second real bug found during live testing: the
 * server was fixed to reject an invalid discount (non-negative, ≤
 * subtotal), but the client's own createSale() had its own independent,
 * unfixed copy of the same unvalidated total math. A cashier could
 * "complete" a sale locally with a nonsensical discount (status became
 * "completed", stock was decremented) that the server would then reject on
 * every sync attempt forever — with no in-app way to void or discard it,
 * since void requires a server _id that a permanently-rejected sale never
 * gets. These tests assert the bad sale is refused locally, before
 * anything is written or any stock is touched.
 */
describe("createSale — discount and price are validated locally, matching the server", () => {
  it("rejects a discount larger than the subtotal, before writing anything", async () => {
    await expect(repo.createSale({ items: [{ productId: "prod1", quantity: 1 }], discount: 500000 })).rejects.toThrow(/cannot exceed subtotal/);
    expect(await db.sales.count()).toBe(0);
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(10); // decrement rolled back
  });

  it("rejects a negative discount, before writing anything", async () => {
    await expect(repo.createSale({ items: [{ productId: "prod1", quantity: 1 }], discount: -120 })).rejects.toThrow(/non-negative/);
    expect(await db.sales.count()).toBe(0);
  });

  it("rejects a non-numeric discount rather than silently treating it as 0", async () => {
    await expect(repo.createSale({ items: [{ productId: "prod1", quantity: 1 }], discount: "abc" })).rejects.toThrow(/non-negative/);
  });

  it("allows a discount exactly equal to the subtotal (free item, total 0)", async () => {
    const sale = await repo.createSale({ items: [{ productId: "prod1", quantity: 1 }], discount: 5000 });
    expect(sale.total).toBe(0);
  });

  it("blocks a cashier from overriding price, rolling back any earlier decrement in the same checkout", async () => {
    loginAs(STORE_A, "user2");
    localStorage.setItem("user", JSON.stringify({ id: "user2", storeId: STORE_A, name: "Cashier", role: "cashier" }));
    await expect(
      repo.createSale({ items: [{ productId: "prod1", quantity: 1, unitPrice: 3000 }] })
    ).rejects.toThrow(/owner or manager/);
    const product = await db.products.get("prod1");
    expect(product.quantityOnHand).toBe(10); // rolled back, not left at 9
  });

  it("allows a manager to override price", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "user1", storeId: STORE_A, name: "Manager", role: "manager" }));
    const sale = await repo.createSale({ items: [{ productId: "prod1", quantity: 1, unitPrice: 3000 }] });
    expect(sale.items[0].unitPrice).toBe(3000);
  });

  it("allows a cashier to submit unitPrice equal to the catalog price (no-op, not a real override)", async () => {
    localStorage.setItem("user", JSON.stringify({ id: "user1", storeId: STORE_A, name: "Cashier", role: "cashier" }));
    const sale = await repo.createSale({ items: [{ productId: "prod1", quantity: 1, unitPrice: 5000 }] });
    expect(sale.items[0].unitPrice).toBe(5000);
  });
});
