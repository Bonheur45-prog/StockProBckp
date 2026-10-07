import { describe, it, expect, beforeEach, vi } from "vitest";
import { db, getMeta, clearLocalData } from "../db.js";

/** Real sync.js, mocked network — same approach as tenantSwitch.test.js. */
vi.unmock("../sync.js");
vi.mock("../api.js", () => ({ api: { post: vi.fn(), get: vi.fn() } }));

const { runSync, listStuckRecords, pendingChangeCount, discardStuckRecord } = await import("../sync.js");
const { api } = await import("../api.js");

const STORE_A = "storeA000000000000000001";
const STORE_B = "storeB000000000000000002";

function loginAs(role, storeId = STORE_A) {
  localStorage.setItem("token", "fake-token");
  localStorage.setItem("user", JSON.stringify({ id: "u1", storeId, name: "T", role }));
}

const emptyPush = (over = {}) => ({
  data: { products: [], sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [], poReceipts: [], expenses: [], priceHistory: [], errors: [], ...over },
});
const emptyPull = (over = {}) => ({
  data: { serverTime: "2026-10-06T10:00:00.000Z", products: [], sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [], expenses: [], priceHistory: [], financeIncluded: true, ...over },
});

const EVERY_TABLE = ["products", "sales", "stockMovements", "creditPayments", "suppliers", "purchaseOrders", "poReceipts", "expenses", "priceHistory", "meta"];
beforeEach(async () => {
  for (const t of EVERY_TABLE) await db[t].clear();
  localStorage.clear();
  loginAs("owner");
  api.post.mockReset();
  api.get.mockReset();
  api.post.mockResolvedValue(emptyPush());
  api.get.mockResolvedValue(emptyPull());
});

const dirtyExpense = (over = {}) => ({ clientId: "ex1", storeId: STORE_A, amount: 500, date: "2026-10-01T10:00:00.000Z", category: "Rent", isDeleted: false, updatedAt: "2026-10-01T10:00:00.000Z", dirty: 1, ...over });
const dirtyHistory = (over = {}) => ({ clientId: "h1", storeId: STORE_A, productId: "p1", productClientId: "p1", field: "costPrice", oldValue: 100, newValue: 120, kind: "change", changedAt: "2026-10-01T10:00:00.000Z", dirty: 1, ...over });

describe("push", () => {
  it("sends dirty expenses and price history, without Dexie-only fields", async () => {
    await db.expenses.put(dirtyExpense());
    await db.priceHistory.put(dirtyHistory());
    await runSync();
    const body = api.post.mock.calls[0][1];
    expect(body.expenses.map((e) => e.clientId)).toEqual(["ex1"]);
    expect(body.priceHistory.map((h) => h.clientId)).toEqual(["h1"]);
    expect(body.expenses[0]).not.toHaveProperty("dirty");
  });

  it("a push with ONLY finance records still goes out (they count as pending work)", async () => {
    await db.priceHistory.put(dirtyHistory());
    await runSync();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("clears dirty and stores the server id once accepted", async () => {
    await db.expenses.put(dirtyExpense());
    await db.priceHistory.put(dirtyHistory());
    api.post.mockResolvedValue(emptyPush({
      expenses: [{ _id: "mongoEx1", clientId: "ex1", storeId: STORE_A, amount: 500, date: "2026-10-01T10:00:00.000Z", category: "Rent", isDeleted: false }],
      priceHistory: [{ _id: "mongoH1", clientId: "h1", storeId: STORE_A, productId: "mongoP1", productClientId: "p1", field: "costPrice", newValue: 120, changedAt: "2026-10-01T10:00:00.000Z" }],
    }));
    await runSync();
    expect(await db.expenses.get("ex1")).toMatchObject({ id: "mongoEx1", dirty: 0 });
    expect(await db.priceHistory.get("h1")).toMatchObject({ id: "mongoH1", dirty: 0, productId: "mongoP1" });
  });

  it("a rejected expense stays dirty, keeps the reason, and shows in the stuck list", async () => {
    await db.expenses.put(dirtyExpense());
    api.post.mockResolvedValue(emptyPush({ errors: [{ type: "expense", clientId: "ex1", message: "Only the owner can edit or delete an expense" }] }));
    await runSync();
    const row = await db.expenses.get("ex1");
    expect(row.dirty).toBe(1);
    expect(row.syncError).toMatch(/Only the owner/);
    const stuck = await listStuckRecords();
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ type: "expense", clientId: "ex1" });
  });

  it("a rejected price-history row stays dirty with its reason", async () => {
    await db.priceHistory.put(dirtyHistory());
    api.post.mockResolvedValue(emptyPush({ errors: [{ type: "priceHistory", clientId: "h1", message: "The product for this price change wasn't found" }] }));
    await runSync();
    expect(await db.priceHistory.get("h1")).toMatchObject({ dirty: 1, syncError: expect.stringMatching(/wasn't found/) });
    expect((await listStuckRecords())[0].type).toBe("priceHistory");
  });

  it("one rejected record doesn't block the accepted one beside it", async () => {
    await db.expenses.put(dirtyExpense({ clientId: "good" }));
    await db.expenses.put(dirtyExpense({ clientId: "bad" }));
    api.post.mockResolvedValue(emptyPush({
      expenses: [{ _id: "m1", clientId: "good", storeId: STORE_A, amount: 500, date: "2026-10-01T10:00:00.000Z" }, { _id: "m2", clientId: "bad", storeId: STORE_A }],
      errors: [{ type: "expense", clientId: "bad", message: "nope" }],
    }));
    await runSync();
    expect((await db.expenses.get("good")).dirty).toBe(0);
    expect((await db.expenses.get("bad")).dirty).toBe(1);
  });

  it("pendingChangeCount counts finance records, for this store only", async () => {
    await db.expenses.put(dirtyExpense());
    await db.priceHistory.put(dirtyHistory());
    await db.expenses.put(dirtyExpense({ clientId: "other", storeId: STORE_B }));
    expect(await pendingChangeCount()).toBe(2);
  });

  it("discarding a stuck never-synced expense deletes it locally", async () => {
    await db.expenses.put(dirtyExpense({ syncError: "rejected" }));
    await discardStuckRecord("expense", "ex1");
    expect(await db.expenses.get("ex1")).toBeUndefined();
  });
});

describe("pull", () => {
  it("stores pulled expenses and price history as clean records", async () => {
    api.get.mockResolvedValue(emptyPull({
      expenses: [{ _id: "mE", clientId: "ex9", storeId: STORE_A, amount: 70, date: "2026-10-02T10:00:00.000Z", isDeleted: false }],
      priceHistory: [{ _id: "mH", clientId: "h9", storeId: STORE_A, productId: "mP", field: "costPrice", newValue: 9, changedAt: "2026-10-02T10:00:00.000Z" }],
    }));
    await runSync();
    expect(await db.expenses.get("ex9")).toMatchObject({ id: "mE", dirty: 0, amount: 70 });
    expect(await db.priceHistory.get("h9")).toMatchObject({ id: "mH", dirty: 0 });
  });

  it("falls back to _id when a pulled row has no clientId (created through the REST route)", async () => {
    api.get.mockResolvedValue(emptyPull({ expenses: [{ _id: "restOnly", storeId: STORE_A, amount: 5, date: "2026-10-02T10:00:00.000Z" }] }));
    await runSync();
    expect(await db.expenses.get("restOnly")).toBeDefined();
  });

  it("never overwrites a local expense that has unsynced edits", async () => {
    await db.expenses.put(dirtyExpense({ clientId: "ex1", amount: 111, dirty: 1 }));
    api.post.mockRejectedValue(new Error("offline")); // keep it dirty through the push step
    api.get.mockResolvedValue(emptyPull({ expenses: [{ _id: "mE", clientId: "ex1", storeId: STORE_A, amount: 999, date: "2026-10-01T10:00:00.000Z" }] }));
    await runSync(); // push throws -> whole sync aborts before pull, so call pull path via a clean push instead:
    api.post.mockResolvedValue(emptyPush({ errors: [{ type: "expense", clientId: "ex1", message: "x" }] }));
    await runSync();
    expect((await db.expenses.get("ex1")).amount).toBe(111);
  });

  it("an older server that sends no finance fields doesn't crash the sync", async () => {
    api.get.mockResolvedValue({ data: { serverTime: "2026-10-06T10:00:00.000Z", products: [], sales: [], stockMovements: [], creditPayments: [], suppliers: [], purchaseOrders: [] } });
    const result = await runSync();
    expect(result.ok).toBe(true);
  });
});

describe("finance pull cursor — owner/manager only, with its own cursor", () => {
  const lastParams = () => api.get.mock.calls.at(-1)[1].params;

  it("a manager's first pull asks for everything, the next one asks only for what's new", async () => {
    loginAs("manager");
    await runSync();
    expect(lastParams()).not.toHaveProperty("financeSince");
    expect(await getMeta("financePulledAt")).toBe("2026-10-06T10:00:00.000Z");
    api.get.mockResolvedValue(emptyPull({ serverTime: "2026-10-06T10:05:00.000Z" }));
    await runSync();
    expect(lastParams().financeSince).toBe("2026-10-06T10:00:00.000Z");
  });

  it("a cashier never asks for finance data and never advances the finance cursor", async () => {
    loginAs("cashier");
    api.get.mockResolvedValue(emptyPull({ financeIncluded: false }));
    await runSync();
    await runSync();
    expect(lastParams()).not.toHaveProperty("financeSince");
    expect(await getMeta("financePulledAt")).toBeNull();
    expect(await getMeta("lastPulledAt")).toBe("2026-10-06T10:00:00.000Z"); // the normal cursor still moves
  });

  it("a cashier logging in on a device a manager used earlier still sends no finance cursor", async () => {
    loginAs("manager");
    await runSync(); // leaves financePulledAt set on this shared device
    expect(await getMeta("financePulledAt")).not.toBeNull();

    loginAs("cashier");
    api.get.mockResolvedValue(emptyPull({ financeIncluded: false }));
    await runSync();
    expect(lastParams()).not.toHaveProperty("financeSince");
  });

  it("a cashier PROMOTED to manager gets the full history, not just what's new since their old cursor", async () => {
    loginAs("cashier");
    api.get.mockResolvedValue(emptyPull({ financeIncluded: false }));
    await runSync();
    expect(await getMeta("lastPulledAt")).not.toBeNull(); // they have a normal cursor already…

    loginAs("manager"); // …then get promoted — and the server now answers for a manager
    api.get.mockResolvedValue(emptyPull({ serverTime: "2026-10-06T11:00:00.000Z" }));
    await runSync();
    expect(lastParams()).toHaveProperty("since"); // normal cursor still used for everything else
    expect(lastParams()).not.toHaveProperty("financeSince"); // but finance data is requested in full
    expect(await getMeta("financePulledAt")).not.toBeNull();
  });

  it("if the server returns no finance data, the cursor does NOT advance", async () => {
    loginAs("manager");
    api.get.mockResolvedValue(emptyPull({ financeIncluded: false }));
    await runSync();
    expect(await getMeta("financePulledAt")).toBeNull();
  });
});

describe("tenant switch", () => {
  it("clearLocalData wipes expenses and price history (no cross-store leak)", async () => {
    await db.expenses.put(dirtyExpense());
    await db.priceHistory.put(dirtyHistory());
    await clearLocalData();
    expect(await db.expenses.count()).toBe(0);
    expect(await db.priceHistory.count()).toBe(0);
  });

  it("a store switch mid-push doesn't write one store's finance data into another's cache", async () => {
    await db.expenses.put(dirtyExpense());
    api.post.mockImplementation(async () => {
      loginAs("owner", STORE_B); // session changes while the request is in flight
      return emptyPush({ expenses: [{ _id: "m1", clientId: "ex1", storeId: STORE_A, amount: 500, date: "2026-10-01T10:00:00.000Z" }] });
    });
    await runSync();
    expect((await db.expenses.get("ex1")).dirty).toBe(1); // reconcile was skipped, as for every other table
  });
});