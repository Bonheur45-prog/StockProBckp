import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import * as repo from "../repo.js";

/** Removed (soft-deleted) products: listing, restoring, and code reservation. */

const STORE_A = "storeA000000000000000001";
const STORE_B = "storeB000000000000000002";

function loginAs(role, storeId = STORE_A) {
  localStorage.setItem("user", JSON.stringify({ id: "u1", storeId, name: "Test", role }));
}
const TABLES = ["products", "priceHistory"];

beforeEach(async () => {
  for (const t of TABLES) await db[t].clear();
  localStorage.clear();
  loginAs("owner");
});

async function seed(over = {}) {
  const p = { clientId: "p1", storeId: STORE_A, name: "Cement", sku: "C-1", barcode: "111", quantityOnHand: 5, costPrice: 10, sellPrice: 20, isDeleted: false, dirty: 0, updatedAt: "2026-01-01T00:00:00.000Z", ...over };
  await db.products.put(p);
  return p;
}

describe("removed products", () => {
  it("a deleted product leaves the catalog and shows in the removed list", async () => {
    await seed();
    await repo.deleteProduct("p1");
    expect(await repo.countProducts()).toBe(0);
    expect((await repo.listRemovedProducts()).map((p) => p.clientId)).toEqual(["p1"]);
    expect(await repo.countRemovedProducts()).toBe(1);
  });

  it("restore brings it back, queues it for sync, and clears the removed list", async () => {
    await seed({ isDeleted: true });
    const back = await repo.restoreProduct("p1");
    expect(back.isDeleted).toBe(false);
    expect((await db.products.get("p1")).dirty).toBe(1);
    expect(await repo.countProducts()).toBe(1);
    expect(await repo.countRemovedProducts()).toBe(0);
  });

  it("restoring writes no price-history row (prices did not change)", async () => {
    await seed({ isDeleted: true });
    await repo.restoreProduct("p1");
    expect(await db.priceHistory.count()).toBe(0);
  });

  it("newest removal is listed first", async () => {
    await seed({ clientId: "a", sku: "A", barcode: "1", isDeleted: true, updatedAt: "2026-01-01T00:00:00.000Z" });
    await seed({ clientId: "b", sku: "B", barcode: "2", isDeleted: true, updatedAt: "2026-02-01T00:00:00.000Z" });
    expect((await repo.listRemovedProducts()).map((p) => p.clientId)).toEqual(["b", "a"]);
  });

  it("a cashier sees nothing and cannot restore", async () => {
    await seed({ isDeleted: true });
    loginAs("cashier");
    expect(await repo.listRemovedProducts()).toEqual([]);
    await expect(repo.restoreProduct("p1")).rejects.toThrow(/owner or manager/);
    expect((await db.products.get("p1")).isDeleted).toBe(true);
  });

  it("a manager can restore", async () => {
    await seed({ isDeleted: true });
    loginAs("manager");
    expect((await repo.restoreProduct("p1")).isDeleted).toBe(false);
  });

  it("another store's removed products are invisible and cannot be restored", async () => {
    await seed({ storeId: STORE_B, isDeleted: true });
    expect(await repo.listRemovedProducts()).toEqual([]);
    await expect(repo.restoreProduct("p1")).rejects.toThrow(/not found/i);
  });

  it("restoring a product that is not removed is refused", async () => {
    await seed();
    await expect(repo.restoreProduct("p1")).rejects.toThrow(/isn't removed/);
  });

  it("restoring an unknown product is refused", async () => {
    await expect(repo.restoreProduct("nope")).rejects.toThrow(/not found/i);
  });
});

describe("codes of removed products stay reserved (the server keeps them too)", () => {
  it("a new product can't reuse a removed product's SKU, and the message says why", async () => {
    await seed({ isDeleted: true });
    await expect(repo.createProduct({ name: "Other", sku: "C-1", sellPrice: "5" })).rejects.toThrow(/SKU already used by "Cement" \(a removed product\)/);
  });

  it("nor its barcode", async () => {
    await seed({ isDeleted: true });
    await expect(repo.createProduct({ name: "Other", barcode: "111", sellPrice: "5" })).rejects.toThrow(/Barcode already used by "Cement" \(a removed product\)/);
  });

  it("a live product with the same code is still named plainly", async () => {
    await seed();
    await expect(repo.createProduct({ name: "Other", sku: "C-1", sellPrice: "5" })).rejects.toThrow(/SKU already used by "Cement"$/);
  });

  it("restore is refused when its code was since taken, with a clear next step", async () => {
    await seed({ isDeleted: true });
    // Code reuse is blocked, so simulate a record that arrived from another device.
    await seed({ clientId: "p2", name: "Cement Pro", sku: "C-1", barcode: "999" });
    await expect(repo.restoreProduct("p1")).rejects.toThrow(/Can't restore "Cement": SKU already used by "Cement Pro"\. Change that product's code first/);
    expect((await db.products.get("p1")).isDeleted).toBe(true);
  });

  it("the other stores' codes never interfere", async () => {
    await seed({ storeId: STORE_B, isDeleted: true });
    await expect(repo.createProduct({ name: "Mine", sku: "C-1", sellPrice: "5" })).resolves.toBeTruthy();
  });

  it("editing a live product does not trip over its own code", async () => {
    await seed();
    await expect(repo.updateProduct("p1", { name: "Cement 50kg" })).resolves.toBeTruthy();
  });
});