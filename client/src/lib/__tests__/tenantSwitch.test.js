import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "../db.js";

/**
 * Same reasoning as syncIssues.test.js: this file needs the REAL sync.js
 * (not the global mock every other test file uses), and mocks only the
 * network boundary below it.
 */
vi.unmock("../sync.js");
vi.mock("../api.js", () => ({ api: { post: vi.fn(), get: vi.fn() } }));

const { runSync, listStuckRecords, pendingChangeCount, discardStuckRecord } = await import("../sync.js");
const { api } = await import("../api.js");

const STORE_A = "storeA000000000000000001";
const STORE_B = "storeB000000000000000002";

function loginAs(storeId, userId = "user1") {
  localStorage.setItem("token", "fake-token");
  localStorage.setItem("user", JSON.stringify({ id: userId, storeId, name: "Test", role: "owner" }));
}

beforeEach(async () => {
  await db.products.clear();
  await db.sales.clear();
  localStorage.clear();
  loginAs(STORE_A);
  api.post.mockReset();
  api.get.mockReset();
});

describe("cross-tenant filtering — listStuckRecords / pendingChangeCount", () => {
  it("only returns the currently-authenticated store's stuck records, not another store's", async () => {
    await db.products.put({ clientId: "pA", storeId: STORE_A, name: "A's product", dirty: 1, syncError: "rejected", updatedAt: new Date().toISOString() });
    await db.products.put({ clientId: "pB", storeId: STORE_B, name: "B's product", dirty: 1, syncError: "rejected", updatedAt: new Date().toISOString() });

    // Still logged in as Store A.
    const stuck = await listStuckRecords();
    expect(stuck).toHaveLength(1);
    expect(stuck[0].clientId).toBe("pA");
  });

  it("pendingChangeCount only counts the current store's dirty records", async () => {
    await db.products.put({ clientId: "pA", storeId: STORE_A, name: "A's product", dirty: 1, updatedAt: new Date().toISOString() });
    await db.products.put({ clientId: "pB", storeId: STORE_B, name: "B's product", dirty: 1, updatedAt: new Date().toISOString() });
    expect(await pendingChangeCount()).toBe(1);
  });

  it("discardStuckRecord refuses to act on a record belonging to a different store", async () => {
    await db.products.put({ clientId: "pB", id: "mongoB1", storeId: STORE_B, name: "B's product", dirty: 1, syncError: "rejected", updatedAt: new Date().toISOString() });
    await discardStuckRecord("product", "pB"); // still authenticated as Store A
    const product = await db.products.get("pB");
    expect(product.dirty).toBe(1); // untouched — refused, not silently no-op'd as "success"
    expect(product.syncError).toBe("rejected");
  });
});

describe("in-flight session switch — push/pull abort rather than cross-write", () => {
  it("a push that started under Store A does not reconcile if the session switches to Store B before the response arrives", async () => {
    await db.products.put({ clientId: "pA", storeId: STORE_A, name: "Hammer", dirty: 1, updatedAt: new Date().toISOString() });

    // Same synchronization approach as the pull test below: trigger the
    // switch from inside api.post's own mock implementation, guaranteeing
    // it happens exactly when pushDirty() makes its network call — after
    // it has already read the dirty records and captured its
    // startingStoreId, not before.
    let resolvePush;
    api.post.mockImplementation(() => {
      loginAs(STORE_B);
      return new Promise((resolve) => { resolvePush = resolve; });
    });
    api.get.mockResolvedValue({ data: { serverTime: new Date().toISOString(), products: [], sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [] } });

    const syncPromise = runSync();
    await vi.waitFor(() => expect(resolvePush).toBeDefined());

    // Now let the push "succeed" — as far as the (stale) request was concerned.
    resolvePush({
      data: {
        products: [{ _id: "mongoA1", clientId: "pA", storeId: STORE_A, name: "Hammer" }],
        sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [], poReceipts: [],
        errors: [],
      },
    });
    await syncPromise;

    const product = await db.products.get("pA");
    expect(product.dirty).toBe(1); // still dirty — the stale "success" was discarded, not applied
    expect(product.id).toBeUndefined(); // never got the server id from the abandoned reconcile
  });

  it("a pull that started under Store A does not write Store A's data into the cache once switched to Store B", async () => {
    api.post.mockResolvedValue({ data: { products: [], sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [], poReceipts: [], errors: [] } });

    // pushDirty() (which runs first, inside runSync()) has its own real
    // async Dexie reads before it even calls api.post, so pullChanges()
    // doesn't start until an indeterminate number of microtask ticks after
    // this test function's own synchronous code has already finished
    // running. Switching stores synchronously right after calling
    // runSync() (like the push test above does) would land the switch
    // BEFORE pullChanges() even starts — it would correctly capture
    // Store B as its own starting point, and the guard would never see a
    // mismatch, making the test pass without actually exercising the
    // abort at all. Triggering the switch from inside api.get's own mock
    // implementation guarantees it happens at the exact moment
    // pullChanges() makes its network call — which is guaranteed to be
    // after it already captured its startingStoreId on the line before.
    let resolvePull;
    api.get.mockImplementation(() => {
      loginAs(STORE_B);
      return new Promise((resolve) => { resolvePull = resolve; });
    });

    const syncPromise = runSync();
    // Wait for pushDirty to actually finish and pullChanges to reach its
    // network call (which triggers the switch above) before resolving.
    await vi.waitFor(() => expect(resolvePull).toBeDefined());

    resolvePull({
      data: {
        serverTime: new Date().toISOString(),
        products: [{ _id: "mongoA2", clientId: "pA2", storeId: STORE_A, name: "Store A's product" }],
        sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [],
      },
    });
    await syncPromise;

    expect(await db.products.get("pA2")).toBeUndefined(); // never written — the stale pull was discarded
  });

  it("a push that completes under the SAME store it started with reconciles normally (the guard isn't over-eager)", async () => {
    await db.products.put({ clientId: "pA", storeId: STORE_A, name: "Hammer", dirty: 1, updatedAt: new Date().toISOString() });
    api.post.mockResolvedValue({
      data: {
        products: [{ _id: "mongoA1", clientId: "pA", storeId: STORE_A, name: "Hammer" }],
        sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [], poReceipts: [],
        errors: [],
      },
    });
    api.get.mockResolvedValue({ data: { serverTime: new Date().toISOString(), products: [], sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [] } });

    await runSync();

    const product = await db.products.get("pA");
    expect(product.dirty).toBe(0);
    expect(product.id).toBe("mongoA1");
  });
});
