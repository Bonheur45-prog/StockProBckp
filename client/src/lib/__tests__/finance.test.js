import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db.js";
import * as repo from "../repo.js";
import { describeAccuracy } from "../profitLoss.js";
import { todayDateInput } from "../dates.js";

/**
 * Expenses, price history, the per-sale cost snapshot and Profit & Loss,
 * exercised through the real local write path (repo.js + Dexie). Sync is
 * mocked globally (setup.js), so these assert what gets WRITTEN and QUEUED.
 */

const STORE_A = "storeA000000000000000001";
const STORE_B = "storeB000000000000000002";
const settle = () => new Promise((r) => setTimeout(r, 8)); // a current period's range ends at "now"

function loginAs(role, storeId = STORE_A, userId = "user1") {
  localStorage.setItem("user", JSON.stringify({ id: userId, storeId, name: "Test", role }));
}

const EVERY_TABLE = ["products", "sales", "stockMovements", "creditPayments", "suppliers", "purchaseOrders", "poReceipts", "expenses", "priceHistory"];

beforeEach(async () => {
  for (const t of EVERY_TABLE) await db[t].clear();
  localStorage.clear();
  loginAs("owner");
});

async function seedProduct(over = {}) {
  const p = {
    clientId: "prod1", storeId: STORE_A, name: "Cement", sku: "C-1", barcode: "111", category: "Building",
    quantityOnHand: 100, costPrice: 100, sellPrice: 150, isDeleted: false, dirty: 0, updatedAt: new Date().toISOString(), ...over,
  };
  await db.products.put(p);
  return p;
}

const historyOf = async (clientId = "prod1") =>
  (await db.priceHistory.toArray()).filter((h) => h.productClientId === clientId).sort((a, b) => a.field.localeCompare(b.field) || a.changedAt.localeCompare(b.changedAt));

describe("price history — written whenever a price REALLY changes", () => {
  it("creating a product records both starting prices", async () => {
    const p = await repo.createProduct({ name: "Nails", costPrice: "40", sellPrice: "60" });
    const rows = await historyOf(p.clientId);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.field, r.oldValue, r.newValue, r.kind, r.dirty])).toEqual([
      ["costPrice", null, 40, "created", 1],
      ["sellPrice", null, 60, "created", 1],
    ]);
    expect(rows[0].storeId).toBe(STORE_A);
    expect(rows[0].changedBy).toBe("user1");
  });

  it("a cost change logs exactly one row with the old and new value", async () => {
    await seedProduct();
    await repo.updateProduct("prod1", { costPrice: "150" });
    const rows = await historyOf();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "costPrice", oldValue: 100, newValue: 150, kind: "change", dirty: 1 });
  });

  it("a sell-price change logs the sell field, not the cost field", async () => {
    await seedProduct();
    await repo.updateProduct("prod1", { sellPrice: 175 });
    expect((await historyOf()).map((r) => [r.field, r.oldValue, r.newValue])).toEqual([["sellPrice", 150, 175]]);
  });

  it("renaming a product (an unrelated edit) logs NOTHING", async () => {
    await seedProduct();
    await repo.updateProduct("prod1", { name: "Cement 50kg", category: "Bulk" });
    expect(await historyOf()).toHaveLength(0);
  });

  it("re-saving the same price — even as a string, as the form submits it — logs NOTHING", async () => {
    await seedProduct();
    await repo.updateProduct("prod1", { costPrice: "100", sellPrice: "150.00", name: "x" });
    expect(await historyOf()).toHaveLength(0);
  });

  it("changing both prices logs two rows", async () => {
    await seedProduct();
    await repo.updateProduct("prod1", { costPrice: 90, sellPrice: 200 });
    expect(await historyOf()).toHaveLength(2);
  });

  it("stock changes, restocks and deletes never log price history", async () => {
    await seedProduct();
    await repo.restock("prod1", 5, "delivery");
    await repo.deleteProduct("prod1");
    expect(await historyOf()).toHaveLength(0);
  });

  it("prices are stored as real numbers, not form strings", async () => {
    await seedProduct();
    await repo.updateProduct("prod1", { costPrice: "150", sellPrice: "200" });
    const p = await db.products.get("prod1");
    expect([typeof p.costPrice, p.costPrice, typeof p.sellPrice, p.sellPrice]).toEqual(["number", 150, "number", 200]);
  });

  it("clearing the cost field records a change to 0 (and says so honestly in history)", async () => {
    await seedProduct();
    await repo.updateProduct("prod1", { costPrice: "" });
    expect((await historyOf())[0]).toMatchObject({ field: "costPrice", oldValue: 100, newValue: 0 });
  });

  it("the product edit and its history row are written together (a failed edit leaves no orphan row)", async () => {
    await seedProduct();
    await seedProduct({ clientId: "prod2", name: "Other", sku: "C-2", barcode: "222" });
    await expect(repo.updateProduct("prod1", { costPrice: 999, barcode: "222" })).rejects.toThrow(/Barcode already used/);
    expect(await historyOf()).toHaveLength(0);
    expect((await db.products.get("prod1")).costPrice).toBe(100);
  });
});

describe("price lookup — 'what did this cost at time X?'", () => {
  async function seedHistory() {
    await seedProduct({ id: "srv1" });
    const row = (field, newValue, changedAt, productId = "prod1") =>
      db.priceHistory.put({ clientId: `${field}-${changedAt}`, storeId: STORE_A, productId, productClientId: "prod1", field, newValue, changedAt, dirty: 0 });
    await row("costPrice", 100, "2026-03-01T10:00:00.000Z", "srv1");
    await row("costPrice", 120, "2026-06-01T10:00:00.000Z", "prod1"); // same product, written under its other id
    await row("sellPrice", 999, "2026-03-01T10:00:00.000Z");
  }

  it("answers from the latest change at-or-before the moment, across both of the product's ids", async () => {
    await seedHistory();
    expect(await repo.getProductPriceAt("prod1", "costPrice", "2026-04-15T00:00:00Z")).toEqual({ value: 100, source: "history" });
    expect(await repo.getProductPriceAt("prod1", "costPrice", "2026-07-01T00:00:00Z")).toEqual({ value: 120, source: "history" });
    expect(await repo.getProductPriceAt("srv1", "costPrice", "2026-07-01T00:00:00Z")).toEqual({ value: 120, source: "history" });
  });

  it("says 'none' for a moment before tracking began — never invents a number", async () => {
    await seedHistory();
    expect(await repo.getProductPriceAt("prod1", "costPrice", "2026-01-01T00:00:00Z")).toEqual({ value: null, source: "none" });
  });

  it("lists a product's changes newest first", async () => {
    await seedHistory();
    const list = await repo.listPriceHistoryForProduct("prod1");
    expect(list[0].changedAt >= list[list.length - 1].changedAt).toBe(true);
  });

  it("a cashier gets nothing", async () => {
    await seedHistory();
    loginAs("cashier");
    expect(await repo.listPriceHistoryForProduct("prod1")).toEqual([]);
  });
});

describe("sale cost snapshot (unitCost)", () => {
  it("records the cost at the moment of sale on each product line", async () => {
    await seedProduct();
    const sale = await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }] });
    expect(sale.items[0].unitCost).toBe(100);
  });

  it("stays correct forever: a LATER cost change never alters an EARLIER sale", async () => {
    await seedProduct();
    await repo.createSale({ items: [{ productId: "prod1", quantity: 1 }] });
    await repo.updateProduct("prod1", { costPrice: 130 });
    await repo.createSale({ items: [{ productId: "prod1", quantity: 1 }] });
    const sales = (await db.sales.toArray()).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    expect(sales.map((s) => s.items[0].unitCost)).toEqual([100, 130]);
  });

  it("a legacy string cost is snapshotted as a number", async () => {
    await seedProduct({ costPrice: "40" });
    const sale = await repo.createSale({ items: [{ productId: "prod1", quantity: 1 }] });
    expect(sale.items[0].unitCost).toBe(40);
  });

  it("a product with no cost ever entered snapshots 0 (and P&L will flag it)", async () => {
    await seedProduct({ costPrice: undefined });
    const sale = await repo.createSale({ items: [{ productId: "prod1", quantity: 1 }] });
    expect(sale.items[0].unitCost).toBe(0);
  });

  it("a custom line has NO unitCost — unknown is not the same as free", async () => {
    const sale = await repo.createSale({ items: [{ isCustom: true, name: "Cut", unitPrice: 500, quantity: 1 }] });
    expect(sale.items[0].unitCost).toBeUndefined();
  });

  it("does not change the sale's money (subtotal/total)", async () => {
    await seedProduct();
    const sale = await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }], discount: 50 });
    expect([sale.subtotal, sale.total]).toEqual([300, 250]);
  });
});

describe("expenses — permissions", () => {
  const input = { amount: 5000, date: "2026-10-01", category: "Rent", paymentMethod: "cash" };

  it("a cashier can't record, list, or view P&L", async () => {
    loginAs("manager");
    await repo.createExpense(input); // a manager's earlier session left data in the shared cache
    loginAs("cashier");
    await expect(repo.createExpense(input)).rejects.toThrow(/owner or manager/);
    expect(await repo.listExpenses()).toEqual([]);
    expect(await repo.listExpenseCategories()).toEqual([]);
    await expect(repo.getProfitAndLoss("month")).rejects.toThrow(/owner or manager/);
    await expect(repo.getIncomeExpenseSeries("month")).rejects.toThrow(/owner or manager/);
  });

  it("a manager can ADD but not edit or delete", async () => {
    loginAs("manager");
    const e = await repo.createExpense(input);
    expect(e.dirty).toBe(1);
    await expect(repo.updateExpense(e.clientId, { amount: 1 })).rejects.toThrow(/Only the owner/);
    await expect(repo.deleteExpense(e.clientId)).rejects.toThrow(/Only the owner/);
    expect((await db.expenses.get(e.clientId)).amount).toBe(5000);
    expect((await db.expenses.get(e.clientId)).isDeleted).toBe(false);
  });

  it("the owner can add, edit, and delete", async () => {
    const e = await repo.createExpense(input);
    const edited = await repo.updateExpense(e.clientId, { amount: "7500.5", description: "  Oct rent " });
    expect([edited.amount, edited.description]).toEqual([7500.5, "Oct rent"]);
    await repo.deleteExpense(e.clientId);
    expect(await repo.listExpenses()).toEqual([]);
    expect((await db.expenses.get(e.clientId)).isDeleted).toBe(true); // soft delete, so sync can propagate it
  });

  it("every write is queued for sync", async () => {
    const e = await repo.createExpense(input);
    await repo.updateExpense(e.clientId, { amount: 6000 });
    expect((await db.expenses.get(e.clientId)).dirty).toBe(1);
  });
});

describe("expenses — validation and storage", () => {
  const ok = { amount: 100, date: "2026-10-01", category: "Fuel" };

  it.each([
    ["zero amount", { ...ok, amount: 0 }, /greater than 0/],
    ["blank amount", { ...ok, amount: "" }, /greater than 0/],
    ["text amount", { ...ok, amount: "abc" }, /greater than 0/],
    ["negative amount", { ...ok, amount: -5 }, /greater than 0/],
    ["no date", { ...ok, date: "" }, /date/i],
    ["impossible date", { ...ok, date: "2026-02-31" }, /exist/],
    ["year typo", { ...ok, date: "0202-10-01" }, /year/],
    ["unknown payment method", { ...ok, paymentMethod: "crypto" }, /payment method/],
    ["recurring with no frequency", { ...ok, isRecurring: true }, /monthly or weekly/],
  ])("rejects %s with a readable message", async (_name, bad, message) => {
    await expect(repo.createExpense(bad)).rejects.toThrow(message);
    expect(await db.expenses.count()).toBe(0);
  });

  it("stores the picked day at local noon and rounds the amount to 2dp", async () => {
    const e = await repo.createExpense({ ...ok, amount: "10.456", date: "2026-10-01" });
    expect(e.amount).toBe(10.46);
    const d = new Date(e.date);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 9, 1, 12]);
  });

  it("snapshots the supplier's name (and survives the supplier being renamed)", async () => {
    await db.suppliers.put({ clientId: "sup1", id: "srvSup1", storeId: STORE_A, name: "Acme Cement", isDeleted: false, dirty: 0 });
    const e = await repo.createExpense({ ...ok, supplierId: "sup1" });
    expect([e.supplierId, e.supplierName]).toEqual(["srvSup1", "Acme Cement"]);
    await db.suppliers.put({ clientId: "sup1", id: "srvSup1", storeId: STORE_A, name: "Renamed", isDeleted: false, dirty: 0 });
    expect((await db.expenses.get(e.clientId)).supplierName).toBe("Acme Cement");
  });

  it("an unknown supplier is simply not linked (the expense still saves)", async () => {
    const e = await repo.createExpense({ ...ok, supplierId: "ghost" });
    expect([e.supplierId, e.supplierName]).toEqual([null, ""]);
  });

  it("filters by search, category, and day range (end exclusive)", async () => {
    await repo.createExpense({ amount: 10, date: "2026-10-01", category: "Rent", description: "October rent" });
    await repo.createExpense({ amount: 20, date: "2026-10-15", category: "Fuel", description: "Truck diesel" });
    await repo.createExpense({ amount: 30, date: "2026-11-01", category: "Fuel" });
    await repo.createExpense({ amount: 40, date: "2026-11-02" }); // no category
    expect((await repo.listExpenses({ search: "diesel" })).map((e) => e.amount)).toEqual([20]);
    expect((await repo.listExpenses({ category: "Fuel" })).map((e) => e.amount)).toEqual([30, 20]); // newest first
    expect((await repo.listExpenses({ category: "__none__" })).map((e) => e.amount)).toEqual([40]);
    const oct = await repo.listExpenses({ from: new Date(2026, 9, 1), to: new Date(2026, 10, 1) });
    expect(oct.map((e) => e.amount)).toEqual([20, 10]); // Nov 1 excluded
    expect(await repo.listExpenseCategories()).toEqual(["Fuel", "Rent"]);
  });

  it("is isolated per store", async () => {
    await repo.createExpense({ ...ok, description: "A's" });
    await db.expenses.put({ clientId: "b1", storeId: STORE_B, amount: 999, date: new Date().toISOString(), category: "Rent", isDeleted: false, dirty: 0 });
    expect((await repo.listExpenses()).map((e) => e.storeId)).toEqual([STORE_A]);
    expect(await repo.listExpenseCategories()).toEqual(["Fuel"]);
    loginAs("owner", STORE_B);
    expect((await repo.listExpenses()).map((e) => e.clientId)).toEqual(["b1"]);
  });

  it("price history is isolated per store too", async () => {
    await seedProduct();
    await db.priceHistory.put({ clientId: "hB", storeId: STORE_B, productId: "prod1", productClientId: "prod1", field: "costPrice", newValue: 1, changedAt: "2026-01-01T00:00:00Z", dirty: 0 });
    expect(await repo.listPriceHistoryForProduct("prod1")).toEqual([]);
  });
});

describe("recurring expenses — manual 'log this period's'", () => {
  const monthAgo = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  };

  async function seedRent() {
    return repo.createExpense({ amount: 400, date: monthAgo(), category: "Rent", description: "Shop rent", paymentMethod: "mobile_money", isRecurring: true, frequency: "monthly", receiptUrl: "http://r/1.jpg" });
  }

  it("a recurring expense starts its own series", async () => {
    const e = await seedRent();
    expect(e.recurringSeriesId).toBe(e.clientId);
  });

  it("offers last month's series as due, and does nothing until confirmed", async () => {
    await seedRent();
    expect(await repo.listDueRecurringExpenses()).toHaveLength(1);
    expect(await db.expenses.count()).toBe(1); // nothing auto-created
  });

  it("confirming creates ONE entry dated today, with the amount the user reviewed", async () => {
    const rent = await seedRent();
    const [due] = await repo.listDueRecurringExpenses();
    const result = await repo.logRecurringExpenses([{ seriesId: due.seriesId, amount: "450" }]);
    expect(result).toEqual({ created: 1, skipped: 0 });

    const all = await db.expenses.toArray();
    const created = all.find((e) => e.clientId !== rent.clientId);
    expect(created).toMatchObject({ amount: 450, category: "Rent", description: "Shop rent", paymentMethod: "mobile_money", isRecurring: true, frequency: "monthly", recurringSeriesId: rent.clientId, dirty: 1, receiptUrl: null });
    const d = new Date(created.date);
    const now = new Date();
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([now.getFullYear(), now.getMonth(), now.getDate()]);
  });

  it("can't be logged twice for the same period (double-tap / second device)", async () => {
    await seedRent();
    const [due] = await repo.listDueRecurringExpenses();
    await repo.logRecurringExpenses([{ seriesId: due.seriesId, amount: 400 }]);
    expect(await repo.logRecurringExpenses([{ seriesId: due.seriesId, amount: 400 }])).toEqual({ created: 0, skipped: 1 });
    expect(await db.expenses.count()).toBe(2);
    expect(await repo.listDueRecurringExpenses()).toEqual([]);
  });

  it("the same series listed twice in one call is logged once", async () => {
    await seedRent();
    const [due] = await repo.listDueRecurringExpenses();
    const r = await repo.logRecurringExpenses([{ seriesId: due.seriesId, amount: 400 }, { seriesId: due.seriesId, amount: 400 }]);
    expect(r.created).toBe(1);
    expect(await db.expenses.count()).toBe(2);
  });

  it("one bad amount creates NOTHING (all-or-nothing)", async () => {
    await seedRent();
    await repo.createExpense({ amount: 80, date: monthAgo(), category: "Electricity", isRecurring: true, frequency: "monthly" });
    const due = await repo.listDueRecurringExpenses();
    const items = due.map((d, i) => ({ seriesId: d.seriesId, amount: i === 1 ? "0" : "50" }));
    await expect(repo.logRecurringExpenses(items)).rejects.toThrow(/greater than 0/);
    expect(await db.expenses.count()).toBe(2); // just the two originals
  });

  it("an unknown series is skipped, not invented", async () => {
    expect(await repo.logRecurringExpenses([{ seriesId: "nope", amount: 5 }])).toEqual({ created: 0, skipped: 1 });
  });

  it("stopping a series (latest entry no longer recurring) ends the reminders", async () => {
    const rent = await seedRent();
    await repo.updateExpense(rent.clientId, { isRecurring: false });
    expect(await repo.listDueRecurringExpenses()).toEqual([]);
  });

  it("a manager may log recurring expenses; a cashier may not", async () => {
    await seedRent();
    loginAs("manager");
    const [due] = await repo.listDueRecurringExpenses();
    expect((await repo.logRecurringExpenses([{ seriesId: due.seriesId, amount: 400 }])).created).toBe(1);
    loginAs("cashier");
    await expect(repo.logRecurringExpenses([])).rejects.toThrow(/owner or manager/);
    expect(await repo.listDueRecurringExpenses()).toEqual([]);
  });
});

describe("profit & loss — end to end through the real write path", () => {
  it("Revenue − COGS − Expenses, with each sale keeping the cost it actually had", async () => {
    await seedProduct(); // cost 100, sell 150
    await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }] }); // revenue 300, cost 2×100 = 200
    await repo.updateProduct("prod1", { costPrice: 130 }); // supplier raises the price
    await repo.createSale({ items: [{ productId: "prod1", quantity: 1 }] }); // revenue 150, cost 1×130
    await repo.createExpense({ amount: 50, date: todayDateInput(), category: "Fuel" });
    await settle();

    const pl = await repo.getProfitAndLoss("today");
    expect(pl.revenue).toBe(450);
    expect(pl.cogs).toBe(330); // 200 + 130 — NOT 3×130 = 390, which re-costing at today's price would give
    expect(pl.grossProfit).toBe(120);
    expect(pl.expenses).toBe(50);
    expect(pl.netProfit).toBe(70);
    expect(pl.cogsBySource.snapshot.lines).toBe(2);
    expect(pl.cogsBySource.estimate.lines).toBe(0);
    expect(describeAccuracy(pl)).toEqual([]); // nothing to apologise for
  });

  it("an OLD sale with no snapshot falls back to the current cost and is clearly labelled an estimate", async () => {
    await seedProduct({ costPrice: 100 });
    await db.sales.put({
      clientId: "old1", storeId: STORE_A, status: "completed", subtotal: 150, discount: 0, total: 150, paymentMethod: "cash",
      items: [{ productId: "prod1", name: "Cement", quantity: 1, unitPrice: 150, lineTotal: 150 }], // no unitCost: pre-feature sale
      occurredAt: new Date(Date.now() - 5000).toISOString(), dirty: 0,
    });
    await settle();
    const pl = await repo.getProfitAndLoss("today");
    expect(pl.cogsBySource.estimate).toEqual({ lines: 1, amount: 100 });
    expect(describeAccuracy(pl).some((n) => n.tone === "warn" && /ESTIMATE/.test(n.text))).toBe(true);
  });

  it("an old sale is costed from price HISTORY when history covers that moment", async () => {
    await seedProduct({ costPrice: 130 }); // cost is 130 today…
    const saleTime = new Date(Date.now() - 5000).toISOString();
    await db.priceHistory.put({ clientId: "h0", storeId: STORE_A, productId: "prod1", productClientId: "prod1", field: "costPrice", newValue: 100, kind: "baseline", changedAt: new Date(Date.now() - 86_400_000).toISOString(), dirty: 0 });
    await db.sales.put({
      clientId: "old2", storeId: STORE_A, status: "completed", subtotal: 150, discount: 0, total: 150, paymentMethod: "cash",
      items: [{ productId: "prod1", name: "Cement", quantity: 1, unitPrice: 150, lineTotal: 150 }],
      occurredAt: saleTime, dirty: 0,
    });
    await settle();
    const pl = await repo.getProfitAndLoss("today");
    expect(pl.cogs).toBe(100); // …but it cost 100 when sold
    expect(pl.cogsBySource.history).toEqual({ lines: 1, amount: 100 });
    expect(pl.cogsBySource.estimate.lines).toBe(0);
  });

  it("a product whose cost was never entered is flagged, not silently 100% margin", async () => {
    await seedProduct({ costPrice: undefined });
    await repo.createSale({ items: [{ productId: "prod1", quantity: 1 }] });
    await settle();
    const pl = await repo.getProfitAndLoss("today");
    expect(pl.zeroCost.lines).toBe(1);
    expect(describeAccuracy(pl).some((n) => /costed at 0/.test(n.text))).toBe(true);
  });

  it("only this store's sales, expenses and costs count", async () => {
    await seedProduct();
    await repo.createSale({ items: [{ productId: "prod1", quantity: 1 }] });
    await db.sales.put({ clientId: "b-sale", storeId: STORE_B, status: "completed", total: 9999, items: [], occurredAt: new Date().toISOString(), dirty: 0 });
    await db.expenses.put({ clientId: "b-exp", storeId: STORE_B, amount: 8888, date: new Date().toISOString(), isDeleted: false, dirty: 0 });
    await settle();
    const pl = await repo.getProfitAndLoss("today");
    expect([pl.revenue, pl.expenses]).toEqual([150, 0]);
  });

  it("honours a custom date range", async () => {
    await db.expenses.put({ clientId: "e1", storeId: STORE_A, amount: 500, date: new Date(2026, 5, 10, 12).toISOString(), category: "Rent", isDeleted: false, dirty: 0 });
    await db.expenses.put({ clientId: "e2", storeId: STORE_A, amount: 70, date: new Date(2026, 6, 10, 12).toISOString(), category: "Rent", isDeleted: false, dirty: 0 });
    const june = { start: new Date(2026, 5, 1), end: new Date(2026, 6, 1) };
    expect((await repo.getProfitAndLoss("month", 0, june)).expenses).toBe(500);
  });

  it("the income/expense series sums to the same totals as the P&L", async () => {
    await seedProduct();
    await repo.createSale({ items: [{ productId: "prod1", quantity: 2 }] });
    await repo.createExpense({ amount: 75, date: todayDateInput(), category: "Fuel" });
    await settle();
    const [pl, series] = await Promise.all([repo.getProfitAndLoss("month"), repo.getIncomeExpenseSeries("month")]);
    expect(series.reduce((n, b) => n + b.income, 0)).toBe(pl.revenue);
    expect(series.reduce((n, b) => n + b.expenses, 0)).toBe(pl.expenses);
  });

  it("an expense logged today counts immediately (not only after midday)", async () => {
    await repo.createExpense({ amount: 60, date: todayDateInput(), category: "Fuel" });
    await settle();
    expect((await repo.getProfitAndLoss("today")).expenses).toBe(60);
    expect((await repo.getProfitAndLoss("month")).expenses).toBe(60);
    expect((await repo.getExpenseSummary("today")).total).toBe(60);
  });
});

describe("expense summary cards", () => {
  it("totals the period, breaks it down by category, and compares with the previous period", async () => {
    const now = new Date();
    const thisMonth = (day) => new Date(now.getFullYear(), now.getMonth(), day, 12).toISOString();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12).toISOString();
    await db.expenses.bulkPut([
      { clientId: "a", storeId: STORE_A, amount: 300, date: thisMonth(1), category: "Rent", isDeleted: false, dirty: 0 },
      { clientId: "b", storeId: STORE_A, amount: 100, date: thisMonth(1), category: "Fuel", isDeleted: false, dirty: 0 },
      { clientId: "c", storeId: STORE_A, amount: 200, date: lastMonth, category: "Rent", isDeleted: false, dirty: 0 },
    ]);
    await settle();
    const s = await repo.getExpenseSummary("month");
    expect(s.total).toBe(400);
    expect(s.count).toBe(2);
    expect(s.byCategory.map((c) => [c.category, c.total])).toEqual([["Rent", 300], ["Fuel", 100]]);
    // previous period is "same elapsed span of last month"; the 200 on last month's 1st is inside it
    expect(s.change).toBe(100); // 400 vs 200 = +100%
  });

  it("a custom range has no 'previous period' to compare with", async () => {
    const s = await repo.getExpenseSummary("month", 0, { start: new Date(2026, 0, 1), end: new Date(2026, 1, 1) });
    expect(s.change).toBeNull();
  });
});