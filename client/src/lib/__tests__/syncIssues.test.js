import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db.js";

/**
 * This file needs the REAL sync.js (listStuckRecords/discardStuckRecord),
 * unlike every other test file, which uses the global mock in setup.js so
 * repo.js's fire-and-forget runSync() calls never touch the network.
 * discardStuckRecord also calls runSync() internally, so instead of
 * mocking sync.js itself (which would mock away the very functions this
 * file exists to test), the network boundary below it — api.js — is
 * mocked instead: push/pull run for real against empty/successful fake
 * responses, so they resolve cleanly with no real HTTP call and no
 * dirty/stuck data left over to interfere with the next test.
 */
vi.unmock("../sync.js");
vi.mock("../api.js", () => ({
  api: {
    post: vi.fn().mockResolvedValue({ data: { serverTime: new Date().toISOString(), products: [], sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [], poReceipts: [], errors: [] } }),
    get: vi.fn().mockResolvedValue({ data: { serverTime: new Date().toISOString(), products: [], sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [] } }),
  },
}));

const { listStuckRecords, discardStuckRecord } = await import("../sync.js");

const STORE_A = "storeA000000000000000001";

beforeEach(async () => {
  await db.products.clear();
  await db.sales.clear();
  await db.stockMovements.clear();
  await db.suppliers.clear();
  localStorage.clear();
  localStorage.setItem("user", JSON.stringify({ id: "user1", storeId: STORE_A, name: "Test", role: "cashier" }));
});

describe("listStuckRecords", () => {
  it("returns nothing when no record has a syncError", async () => {
    await db.products.put({ clientId: "p1", storeId: STORE_A, name: "Hammer", dirty: 1, updatedAt: new Date().toISOString() });
    expect(await listStuckRecords()).toHaveLength(0);
  });

  it("returns a dirty record with a syncError, tagged with its type", async () => {
    await db.products.put({ clientId: "p1", storeId: STORE_A, name: "Hammer", dirty: 1, syncError: "role does not permit product changes", updatedAt: new Date().toISOString() });
    const stuck = await listStuckRecords();
    expect(stuck).toHaveLength(1);
    expect(stuck[0].type).toBe("product");
    expect(stuck[0].name).toBe("Hammer");
  });

  it("does not return a record that has a syncError but is no longer dirty (already resolved)", async () => {
    await db.products.put({ clientId: "p1", storeId: STORE_A, name: "Hammer", dirty: 0, syncError: "stale leftover", updatedAt: new Date().toISOString() });
    expect(await listStuckRecords()).toHaveLength(0);
  });

  it("a stuck stock movement keeps its SYNC type — its own 'restock'/'adjustment' type must not overwrite it", async () => {
    await db.stockMovements.put({ clientId: "m1", storeId: STORE_A, productId: "p1", type: "restock", reason: "delivery", quantity: 5, dirty: 1, syncError: "Product not found", createdAt: new Date().toISOString() });
    const [stuck] = await listStuckRecords();
    expect(stuck.type).toBe("stockMovement");
    expect(stuck.recordType).toBe("restock"); // the movement's own type is still available, under another name
  });

  it("a stuck restock can actually be DISCARDED from the recovery screen", async () => {
    await db.stockMovements.put({ clientId: "m1", storeId: STORE_A, productId: "p1", type: "restock", quantity: 5, dirty: 1, syncError: "Product not found", createdAt: new Date().toISOString() });
    const [stuck] = await listStuckRecords();
    await discardStuckRecord(stuck.type, stuck.clientId); // exactly what SyncIssues.jsx does
    expect(await db.stockMovements.get("m1")).toBeUndefined();
  });

  it("collects stuck records across multiple tables", async () => {
    await db.products.put({ clientId: "p1", storeId: STORE_A, name: "Hammer", dirty: 1, syncError: "role does not permit product changes", updatedAt: new Date().toISOString() });
    await db.suppliers.put({ clientId: "s1", storeId: STORE_A, name: "ACME", dirty: 1, syncError: "role does not permit supplier changes", updatedAt: new Date().toISOString() });
    const stuck = await listStuckRecords();
    expect(stuck.map((r) => r.type).sort()).toEqual(["product", "supplier"]);
  });
});

describe("discardStuckRecord", () => {
  it("never-synced record (no server id) is deleted outright", async () => {
    await db.sales.put({ clientId: "sale1", storeId: STORE_A, total: 5000, dirty: 1, syncError: "Discount cannot exceed subtotal", updatedAt: new Date().toISOString() });
    await discardStuckRecord("sale", "sale1");
    expect(await db.sales.get("sale1")).toBeUndefined();
  });

  it("previously-synced record (has a server id) is kept, just cleared — not deleted", async () => {
    await db.products.put({ clientId: "p1", id: "mongo123", storeId: STORE_A, name: "Hammer", dirty: 1, syncError: "role does not permit product changes", updatedAt: new Date().toISOString() });
    await discardStuckRecord("product", "p1");
    const product = await db.products.get("p1");
    expect(product).toBeDefined();
    expect(product.dirty).toBeFalsy();
    expect(product.syncError).toBeFalsy();
    expect(product.name).toBe("Hammer"); // untouched otherwise — pull (triggered by this call) is what restores true values, not this function guessing them
  });

  it("discarding a record that no longer exists locally is a harmless no-op", async () => {
    await expect(discardStuckRecord("product", "does-not-exist")).resolves.not.toThrow();
  });

  it("throws on an unknown record type rather than silently doing nothing", async () => {
    await expect(discardStuckRecord("not-a-real-type", "x")).rejects.toThrow(/Unknown record type/);
  });

  it("a discarded record no longer appears in listStuckRecords afterward", async () => {
    await db.products.put({ clientId: "p1", id: "mongo123", storeId: STORE_A, name: "Hammer", dirty: 1, syncError: "role does not permit product changes", updatedAt: new Date().toISOString() });
    await db.sales.put({ clientId: "sale1", storeId: STORE_A, total: 5000, dirty: 1, syncError: "Discount cannot exceed subtotal", updatedAt: new Date().toISOString() });
    expect(await listStuckRecords()).toHaveLength(2);

    await discardStuckRecord("product", "p1");
    await discardStuckRecord("sale", "sale1");
    expect(await listStuckRecords()).toHaveLength(0);
  });
});