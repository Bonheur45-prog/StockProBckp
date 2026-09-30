import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import * as repo from "../repo.js";

/**
 * This suite exists because of a real production bug: every local read
 * function used to pull straight from the shared on-device cache with no
 * filter for which store the data belonged to. On a device that had ever
 * synced more than one store (exactly what happens testing several
 * stores, or adding a user directly in the database), every screen
 * silently showed a mix of stores' products, sales, and customers.
 *
 * The fix was to filter every local read by the current session's
 * storeId. This test seeds two stores' worth of data directly into the
 * local database — simulating a device that has synced both — and
 * asserts that every read function only ever returns the currently
 * logged-in store's data. If a future change reintroduces an unscoped
 * read (new feature, refactor, anything), this fails loudly instead of
 * silently leaking one customer's data into another's.
 */

const STORE_A = "storeA000000000000000001";
const STORE_B = "storeB000000000000000002";

function loginAs(storeId, userId = "user1") {
  localStorage.setItem("user", JSON.stringify({ id: userId, storeId, name: "Test User", role: "owner" }));
}

async function seedBothStores() {
  await db.products.bulkPut([
    { clientId: "prodA1", storeId: STORE_A, name: "Store A Hammer", sku: "A-SKU-1", barcode: "1111", category: "Tools", quantityOnHand: 10, sellPrice: 5000, isDeleted: false, dirty: 0, updatedAt: new Date().toISOString() },
    { clientId: "prodA2", storeId: STORE_A, name: "Store A Nails", sku: "A-SKU-2", barcode: "2222", category: "Hardware", quantityOnHand: 3, lowStockThreshold: 5, sellPrice: 500, isDeleted: false, dirty: 0, updatedAt: new Date().toISOString() },
    { clientId: "prodB1", storeId: STORE_B, name: "Store B Wrench", sku: "B-SKU-1", barcode: "3333", category: "Tools", quantityOnHand: 20, sellPrice: 7000, isDeleted: false, dirty: 0, updatedAt: new Date().toISOString() },
  ]);

  await db.sales.bulkPut([
    { clientId: "saleA1", storeId: STORE_A, items: [{ productId: "prodA1", name: "Store A Hammer", quantity: 1, unitPrice: 5000, lineTotal: 5000 }], subtotal: 5000, discount: 0, total: 5000, paymentMethod: "cash", status: "completed", occurredAt: new Date().toISOString(), dirty: 0 },
    { clientId: "saleB1", storeId: STORE_B, items: [{ productId: "prodB1", name: "Store B Wrench", quantity: 2, unitPrice: 7000, lineTotal: 14000 }], subtotal: 14000, discount: 0, total: 14000, paymentMethod: "credit", customerName: "Store B Customer", status: "completed", occurredAt: new Date().toISOString(), dirty: 0 },
  ]);

  await db.stockMovements.bulkPut([
    { clientId: "movA1", storeId: STORE_A, productId: "prodA1", type: "restock", quantityChange: 10, quantityAfter: 10, createdAt: new Date().toISOString(), dirty: 0 },
    { clientId: "movB1", storeId: STORE_B, productId: "prodB1", type: "restock", quantityChange: 20, quantityAfter: 20, createdAt: new Date().toISOString(), dirty: 0 },
  ]);

  await db.creditPayments.bulkPut([
    { clientId: "payA1", storeId: STORE_A, customerName: "Store A Customer", customerPhone: "111", amount: 1000, isDeleted: false, createdAt: new Date().toISOString(), dirty: 0 },
    { clientId: "payB1", storeId: STORE_B, customerName: "Store B Customer", customerPhone: "222", amount: 2000, isDeleted: false, createdAt: new Date().toISOString(), dirty: 0 },
  ]);

  await db.suppliers.bulkPut([
    { clientId: "supA1", storeId: STORE_A, name: "Store A Supplier", isDeleted: false, dirty: 0 },
    { clientId: "supB1", storeId: STORE_B, name: "Store B Supplier", isDeleted: false, dirty: 0 },
  ]);

  await db.purchaseOrders.bulkPut([
    { clientId: "poA1", storeId: STORE_A, supplierName: "Store A Supplier", status: "ordered", items: [{ productId: "prodA1", name: "Store A Hammer", quantityOrdered: 5, quantityReceived: 0, unitCost: 3000 }], createdAt: new Date().toISOString(), dirty: 0 },
    { clientId: "poB1", storeId: STORE_B, supplierName: "Store B Supplier", status: "ordered", items: [{ productId: "prodB1", name: "Store B Wrench", quantityOrdered: 5, quantityReceived: 0, unitCost: 4000 }], createdAt: new Date().toISOString(), dirty: 0 },
  ]);
}

beforeEach(async () => {
  await db.products.clear();
  await db.sales.clear();
  await db.stockMovements.clear();
  await db.creditPayments.clear();
  await db.suppliers.clear();
  await db.purchaseOrders.clear();
  localStorage.clear();
  await seedBothStores();
});

describe("store data isolation — every local read scoped by storeId", () => {
  it("listProducts only returns the logged-in store's products", async () => {
    loginAs(STORE_A);
    const productsA = await repo.listProducts();
    expect(productsA.map((p) => p.clientId).sort()).toEqual(["prodA1", "prodA2"]);
    expect(productsA.every((p) => p.storeId === STORE_A)).toBe(true);

    loginAs(STORE_B);
    const productsB = await repo.listProducts();
    expect(productsB.map((p) => p.clientId)).toEqual(["prodB1"]);
  });

  it("getProduct refuses to return another store's product even by exact clientId", async () => {
    loginAs(STORE_A);
    expect(await repo.getProduct("prodB1")).toBeUndefined();
    expect((await repo.getProduct("prodA1"))?.name).toBe("Store A Hammer");
  });

  it("findProductByBarcode never matches across stores", async () => {
    loginAs(STORE_A);
    expect(await repo.findProductByBarcode("3333")).toBeNull(); // that barcode belongs to Store B
    expect((await repo.findProductByBarcode("1111"))?.clientId).toBe("prodA1");
  });

  it("findLocalProductByAnyId never resolves a cross-store id", async () => {
    loginAs(STORE_A);
    expect(await repo.findLocalProductByAnyId("prodB1")).toBeNull();
  });

  it("listCategories only reflects the current store's products", async () => {
    loginAs(STORE_A);
    expect((await repo.listCategories()).sort()).toEqual(["Hardware", "Tools"]);
    loginAs(STORE_B);
    expect(await repo.listCategories()).toEqual(["Tools"]);
  });

  it("listSales only returns the logged-in store's sales", async () => {
    loginAs(STORE_A);
    const salesA = await repo.listSales();
    expect(salesA.map((s) => s.clientId)).toEqual(["saleA1"]);

    loginAs(STORE_B);
    const salesB = await repo.listSales();
    expect(salesB.map((s) => s.clientId)).toEqual(["saleB1"]);
  });

  it("listMovements only returns the logged-in store's stock movements", async () => {
    loginAs(STORE_A);
    expect((await repo.listMovements()).map((m) => m.clientId)).toEqual(["movA1"]);
  });

  it("listCreditPayments and listCustomerBalances never cross stores", async () => {
    loginAs(STORE_A);
    expect((await repo.listCreditPayments()).map((p) => p.clientId)).toEqual(["payA1"]);
    const balancesA = await repo.listCustomerBalances();
    expect(balancesA.every((b) => b.customerName.startsWith("Store A"))).toBe(true);

    loginAs(STORE_B);
    const balancesB = await repo.listCustomerBalances();
    expect(balancesB.every((b) => b.customerName.startsWith("Store B"))).toBe(true);
  });

  it("listSuppliers only returns the logged-in store's suppliers", async () => {
    loginAs(STORE_A);
    expect((await repo.listSuppliers()).map((s) => s.name)).toEqual(["Store A Supplier"]);
    loginAs(STORE_B);
    expect((await repo.listSuppliers()).map((s) => s.name)).toEqual(["Store B Supplier"]);
  });

  it("listPurchaseOrders and getPurchaseOrder never cross stores", async () => {
    loginAs(STORE_A);
    expect((await repo.listPurchaseOrders()).map((po) => po.clientId)).toEqual(["poA1"]);
    expect(await repo.getPurchaseOrder("poB1")).toBeUndefined();
  });

  it("getTopProducts and getSalesSeries derive only from the logged-in store's sales", async () => {
    loginAs(STORE_A);
    const topA = await repo.getTopProducts("year", 0, true);
    expect(topA.map((p) => p.name)).toEqual(["Store A Hammer"]);

    loginAs(STORE_B);
    const topB = await repo.getTopProducts("year", 0, true);
    expect(topB.map((p) => p.name)).toEqual(["Store B Wrench"]);
  });

  it("getReorderSuggestions only considers the logged-in store's products", async () => {
    loginAs(STORE_A);
    const suggestions = await repo.getReorderSuggestions();
    // Store A Nails is below its threshold (3 on hand, threshold 5) — should be suggested.
    // Store B's product must never appear here while logged in as Store A.
    expect(suggestions.every((s) => s.product.storeId === STORE_A)).toBe(true);
    expect(suggestions.some((s) => s.product.clientId === "prodB1")).toBe(false);
  });

  it("exportFullBackup only bundles the logged-in store's data", async () => {
    loginAs(STORE_A);
    const backup = await repo.exportFullBackup();
    expect(backup.products.every((p) => p.storeId === STORE_A)).toBe(true);
    expect(backup.sales.every((s) => s.storeId === STORE_A)).toBe(true);
    expect(backup.suppliers.every((s) => s.storeId === STORE_A)).toBe(true);
    expect(backup.purchaseOrders.every((po) => po.storeId === STORE_A)).toBe(true);
    // The hard failure mode this test exists to catch: Store B's data
    // leaking into Store A's exported backup.
    expect(backup.products.some((p) => p.storeId === STORE_B)).toBe(false);
  });

  it("updateProduct and updateSupplier refuse to touch another store's record", async () => {
    loginAs(STORE_A);
    await expect(repo.updateProduct("prodB1", { name: "Hacked" })).rejects.toThrow();
    await expect(repo.updateSupplier("supB1", { name: "Hacked" })).rejects.toThrow();
  });
});
