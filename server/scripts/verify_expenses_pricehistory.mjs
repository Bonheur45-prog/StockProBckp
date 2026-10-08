// Verifies the Expenses + Price History + unitCost-snapshot server logic by
// importing the REAL modules (not copies) and stubbing only the Mongoose
// model I/O methods, so no database is needed.
//
// Run from server/:   node scripts/verify_expenses_pricehistory.mjs

import mongoose from "mongoose";
import Expense from "../src/models/Expense.js";
import PriceHistory from "../src/models/PriceHistory.js";
import Product from "../src/models/Product.js";
import Supplier from "../src/models/Supplier.js";
import Sale from "../src/models/Sale.js";
import StockMovement from "../src/models/StockMovement.js";
import AuditLog from "../src/models/AuditLog.js";
import { performUpsertExpense } from "../src/controllers/expenseController.js";
import { performSaleCreation } from "../src/controllers/saleController.js";
import { pull, push } from "../src/controllers/syncController.js";
import { protect } from "../src/middleware/auth.js";
import User from "../src/models/User.js";
import Store from "../src/models/Store.js";
import jwt from "jsonwebtoken";
import { recordPriceChanges, priceAt, toPrice } from "../src/utils/priceHistory.js";

let pass = 0;
let fail = 0;
function ok(desc, cond, extra = "") {
  if (cond) pass++;
  else {
    fail++;
    console.log(`FAIL: ${desc} ${extra}`);
  }
}
async function rejects(desc, fn, { status, includes } = {}) {
  try {
    await fn();
    fail++;
    console.log(`FAIL (did not throw): ${desc}`);
  } catch (e) {
    const statusOk = status === undefined || e.statusCode === status;
    const msgOk = !includes || String(e.message).includes(includes);
    if (statusOk && msgOk) pass++;
    else {
      fail++;
      console.log(`FAIL (wrong error): ${desc} -> status ${e.statusCode}, "${e.message}"`);
    }
  }
}

const STORE = new mongoose.Types.ObjectId().toString();
const OWNER = new mongoose.Types.ObjectId().toString();
const MANAGER = new mongoose.Types.ObjectId().toString();

// Audit logging is fire-and-forget in the real code; keep it off the DB.
const audits = [];
AuditLog.create = async (doc) => {
  audits.push(doc);
  return doc;
};

// ---------------------------------------------------------------- schemas
{
  const good = new Expense({ storeId: STORE, amount: 5000, date: new Date(), category: "Rent" });
  ok("valid expense passes schema", !good.validateSync());
  ok("negative amount fails schema", !!new Expense({ storeId: STORE, amount: -1, date: new Date() }).validateSync());
  ok("missing date fails schema", !!new Expense({ storeId: STORE, amount: 1 }).validateSync());
  ok("bad paymentMethod fails schema", !!new Expense({ storeId: STORE, amount: 1, date: new Date(), paymentMethod: "bitcoin" }).validateSync());
  ok("bad frequency fails schema", !!new Expense({ storeId: STORE, amount: 1, date: new Date(), isRecurring: true, frequency: "daily" }).validateSync());
  ok("expense frequency defaults to null", new Expense({ storeId: STORE, amount: 1, date: new Date() }).frequency === null);

  const ph = new PriceHistory({ storeId: STORE, productId: new mongoose.Types.ObjectId(), field: "costPrice", newValue: 10, changedAt: new Date(), clientId: "x" });
  ok("valid price history passes schema", !ph.validateSync());
  ok("bad price field fails schema", !!new PriceHistory({ storeId: STORE, productId: new mongoose.Types.ObjectId(), field: "weight", newValue: 1, changedAt: new Date(), clientId: "x" }).validateSync());

  const line = new Sale({ storeId: STORE, items: [{ name: "x", unitPrice: 1, quantity: 1, lineTotal: 1 }], subtotal: 1, total: 1, soldByUserId: OWNER });
  ok("legacy sale line (no unitCost) still valid", !line.validateSync());
  ok("legacy sale line has NO unitCost (not defaulted to 0)", line.items[0].unitCost === undefined);
  ok("negative unitCost fails schema", !!new Sale({ storeId: STORE, items: [{ name: "x", unitPrice: 1, unitCost: -1, quantity: 1, lineTotal: 1 }], subtotal: 1, total: 1, soldByUserId: OWNER }).validateSync());
}

// ------------------------------------------------- performUpsertExpense
{
  const store = new Map(); // clientId -> doc
  Expense.findOne = async ({ clientId }) => store.get(clientId) || null;
  Expense.create = async (doc) => {
    const saved = { ...doc, _id: new mongoose.Types.ObjectId(), updatedAt: new Date(), toObject() { return { ...this }; } };
    store.set(doc.clientId, saved);
    return saved;
  };
  Supplier.findOne = async ({ clientId, _id }) => (clientId === "sup-local" || _id ? { _id: new mongoose.Types.ObjectId(), name: "Acme Cement" } : null);

  const base = { amount: 12000, date: "2026-10-01T10:00:00.000Z", category: "  Rent ", paymentMethod: "cash" };

  await rejects("cashier cannot record an expense (403)", () => performUpsertExpense(STORE, OWNER, "cashier", { ...base, clientId: "c0" }), { status: 403 });

  const created = await performUpsertExpense(STORE, MANAGER, "manager", { ...base, clientId: "c1", description: " March rent " });
  ok("manager can create", created.amount === 12000);
  ok("category trimmed", created.category === "Rent");
  ok("description trimmed", created.description === "March rent");
  ok("createdBy recorded", created.createdBy === MANAGER);

  ok("amount rounded to 2dp", (await performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c-round", amount: "10.456" })).amount === 10.46);
  await rejects("amount 0 rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c2", amount: 0 }), { status: 400, includes: "greater than 0" });
  await rejects("amount negative rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c3", amount: -5 }), { status: 400 });
  await rejects("amount non-numeric rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c4", amount: "abc" }), { status: 400 });
  await rejects("amount blank rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c5", amount: "" }), { status: 400 });
  await rejects("missing date rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c6", date: undefined }), { status: 400, includes: "date" });
  await rejects("garbage date rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c7", date: "not-a-date" }), { status: 400 });
  await rejects("year typo rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c8", date: "0202-10-01" }), { status: 400, includes: "year" });
  await rejects("unknown payment method rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c9", paymentMethod: "crypto" }), { status: 400 });

  const mgrDeleted = await performUpsertExpense(STORE, MANAGER, "manager", { ...base, clientId: "c10", isDeleted: true });
  ok("manager cannot create an already-deleted expense", !mgrDeleted.isDeleted);

  await rejects("recurring without frequency rejected", () => performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c11", isRecurring: true }), { status: 400, includes: "monthly or weekly" });
  const rec = await performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c12", isRecurring: true, frequency: "monthly" });
  ok("recurring expense starts its own series", rec.recurringSeriesId === "c12" && rec.isRecurring && rec.frequency === "monthly");
  const nonRec = await performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c13", isRecurring: false, frequency: "weekly" });
  ok("non-recurring clears any frequency", nonRec.isRecurring === false && nonRec.frequency === null);

  const withSup = await performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c14", supplierId: "sup-local", supplierName: "stale name" });
  ok("supplier resolved by clientId, name snapshotted from supplier", !!withSup.supplierId && withSup.supplierName === "Acme Cement");
  const noSup = await performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c15", supplierId: "never-synced", supplierName: "Local Co" });
  ok("unresolvable supplier still saves with name snapshot, no link", noSup.supplierId === null && noSup.supplierName === "Local Co");

  // --- replay / edit rules on an existing record
  const existing = store.get("c1");
  existing.updatedAt = new Date("2026-10-01T10:00:00.000Z");
  existing.save = async function () { this.saved = true; return this; };

  const replay = await performUpsertExpense(STORE, MANAGER, "manager", { ...base, clientId: "c1", description: "March rent" });
  ok("identical replay by the manager is a harmless no-op", replay === existing && !existing.saved);

  await rejects("manager cannot EDIT an existing expense (403)", () => performUpsertExpense(STORE, MANAGER, "manager", { ...base, clientId: "c1", description: "March rent", amount: 99999, updatedAt: "2026-10-02T00:00:00.000Z" }), { status: 403, includes: "owner" });
  ok("...and nothing was changed", existing.amount === 12000 && !existing.saved);

  await performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c1", description: "March rent", amount: 99999, updatedAt: "2026-09-30T00:00:00.000Z" });
  ok("owner's STALE edit is ignored (last-write-wins)", existing.amount === 12000 && !existing.saved);

  await performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c1", description: "March rent", amount: 15000, updatedAt: "2026-10-02T00:00:00.000Z" });
  ok("owner's NEWER edit applied", existing.amount === 15000 && existing.saved === true);
  ok("edit stamped updatedBy owner", existing.updatedBy === OWNER);

  existing.saved = false;
  await rejects("manager cannot soft-delete (403)", () => performUpsertExpense(STORE, MANAGER, "manager", { ...base, clientId: "c1", description: "March rent", amount: 15000, isDeleted: true, updatedAt: "2026-10-03T00:00:00.000Z" }), { status: 403 });
  ok("manager delete did nothing", !existing.isDeleted);
  existing.updatedAt = new Date("2026-10-02T00:00:00.000Z");
  const auditsBefore = audits.length;
  await performUpsertExpense(STORE, OWNER, "owner", { ...base, clientId: "c1", description: "March rent", amount: 15000, isDeleted: true, updatedAt: "2026-10-03T00:00:00.000Z" });
  ok("owner can soft-delete", existing.isDeleted === true);
  ok("delete audited as expense.delete", audits.length > auditsBefore && audits.at(-1).action === "expense.delete");
}

// ------------------------------------------------------ price history
{
  const captured = [];
  PriceHistory.insertMany = async (rows) => {
    captured.push(...rows);
    return rows;
  };
  const product = { _id: new mongoose.Types.ObjectId(), clientId: "p-local" };

  const created = await recordPriceChanges({ storeId: STORE, product, after: { costPrice: 100, sellPrice: 150 }, userId: OWNER, kind: "created" });
  ok("created logs BOTH fields", created.length === 2 && created.every((r) => r.oldValue === null && r.kind === "created"));

  captured.length = 0;
  let r = await recordPriceChanges({ storeId: STORE, product, before: { costPrice: 100, sellPrice: 150 }, after: { costPrice: 120, sellPrice: 150 }, userId: OWNER });
  ok("only the changed field is logged", r.length === 1 && r[0].field === "costPrice" && r[0].oldValue === 100 && r[0].newValue === 120);
  ok("row carries product ids + author", r[0].productClientId === "p-local" && String(r[0].productId) === String(product._id) && r[0].changedBy === OWNER);

  captured.length = 0;
  r = await recordPriceChanges({ storeId: STORE, product, before: { costPrice: 100, sellPrice: 150 }, after: { costPrice: 100, sellPrice: 150 }, userId: OWNER });
  ok("unrelated edit (no price change) logs NOTHING", r.length === 0 && captured.length === 0);

  r = await recordPriceChanges({ storeId: STORE, product, before: { costPrice: 100, sellPrice: 150 }, after: { costPrice: "100", sellPrice: "150.00" }, userId: OWNER });
  ok("string-vs-number same price is not a change", r.length === 0);

  r = await recordPriceChanges({ storeId: STORE, product, before: { costPrice: 100, sellPrice: 150 }, after: { costPrice: 90, sellPrice: 200 }, userId: OWNER });
  ok("both fields changed -> two rows", r.length === 2);

  ok("toPrice: '' -> null", toPrice("") === null);
  ok("toPrice: -1 -> null", toPrice(-1) === null);
  ok("toPrice: 'abc' -> null", toPrice("abc") === null);
  ok("toPrice: '12.5' -> 12.5", toPrice("12.5") === 12.5);
  ok("toPrice: 0 -> 0", toPrice(0) === 0);

  // lookup
  const T = (d) => new Date(`2026-${d}T12:00:00Z`);
  const rows = [
    { field: "costPrice", newValue: 100, changedAt: T("03-01") },
    { field: "costPrice", newValue: 120, changedAt: T("06-01") },
    { field: "sellPrice", newValue: 999, changedAt: T("04-01") },
    { field: "costPrice", newValue: 150, changedAt: T("09-01") },
  ];
  ok("lookup before first row -> null (history can't answer)", priceAt(rows, "costPrice", T("02-01")) === null);
  ok("lookup between rows -> earlier row", priceAt(rows, "costPrice", T("07-15")) === 120);
  ok("lookup exactly at a change time -> that change", priceAt(rows, "costPrice", T("06-01")) === 120);
  ok("lookup after last row -> last row", priceAt(rows, "costPrice", T("12-01")) === 150);
  ok("lookup ignores other fields", priceAt(rows, "costPrice", T("04-15")) === 100);
  ok("lookup sell field independent", priceAt(rows, "sellPrice", T("05-01")) === 999);
  ok("lookup with no rows -> null", priceAt([], "costPrice", T("05-01")) === null);
}

// ------------------------------------------- unitCost snapshot on sale
{
  mongoose.startSession = async () => ({ withTransaction: (fn) => fn(), endSession() {} });
  const pid = new mongoose.Types.ObjectId();
  const makeProduct = () => ({
    _id: pid, clientId: "p-local", name: "Cement", quantityOnHand: 50, costPrice: 100, sellPrice: 150,
    async save() { return this; },
  });
  let created;
  Product.find = () => ({ session: async () => [makeProduct()] });
  Sale.findOne = async () => null;
  Sale.create = async ([doc]) => {
    created = { ...doc, _id: new mongoose.Types.ObjectId(), toObject() { return { ...this }; } };
    return [created];
  };
  StockMovement.insertMany = async () => [];

  const sell = (extra) => performSaleCreation(STORE, OWNER, { items: [{ productId: String(pid), quantity: 2, ...extra }] }, "owner");

  await sell({});
  ok("no client cost -> falls back to product cost now (100)", created.items[0].unitCost === 100);
  await sell({ unitCost: 90 });
  ok("valid client cost WINS (offline sale knew its own cost)", created.items[0].unitCost === 90);
  await sell({ unitCost: 0 });
  ok("client cost of exactly 0 is honoured, not treated as missing", created.items[0].unitCost === 0);
  await sell({ unitCost: "abc" });
  ok("garbage client cost -> fallback", created.items[0].unitCost === 100);
  await sell({ unitCost: -5 });
  ok("negative client cost -> fallback", created.items[0].unitCost === 100);
  await sell({ unitCost: "" });
  ok("blank client cost -> fallback", created.items[0].unitCost === 100);
  await sell({ unitCost: null });
  ok("null client cost -> fallback", created.items[0].unitCost === 100);

  await performSaleCreation(STORE, OWNER, { items: [{ isCustom: true, name: "Cut to length", unitPrice: 500, quantity: 1 }] }, "owner");
  ok("custom line has NO unitCost (cost unknown, not 0)", created.items[0].unitCost === undefined);
  ok("sale total unaffected by cost field", created.total === 500);
}

// ------------------------------------------------------- sync pull/push
function fakeRes() {
  return { body: null, statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const user = (role) => ({ id: role === "owner" ? OWNER : MANAGER, storeId: STORE, role });

{
  // pull: cashier must never receive finance data
  let expenseFindCalled = false;
  let historyFindCalled = false;
  for (const M of [Product, Sale, StockMovement, Supplier]) M.find = async () => [];
  const CreditPayment = (await import("../src/models/CreditPayment.js")).default;
  const PurchaseOrder = (await import("../src/models/PurchaseOrder.js")).default;
  CreditPayment.find = async () => [];
  PurchaseOrder.find = async () => [];
  Expense.find = async () => { expenseFindCalled = true; return [{ clientId: "e1" }]; };
  PriceHistory.find = async () => { historyFindCalled = true; return [{ clientId: "h1" }]; };

  let res = fakeRes();
  await pull({ query: {}, user: user("cashier") }, res, (e) => { throw e; });
  ok("cashier pull gets no expenses/price history", res.body.expenses.length === 0 && res.body.priceHistory.length === 0 && res.body.financeIncluded === false);
  ok("cashier pull never even queries finance collections", !expenseFindCalled && !historyFindCalled);

  res = fakeRes();
  await pull({ query: {}, user: user("manager") }, res, (e) => { throw e; });
  ok("manager pull gets finance data + flag", res.body.expenses.length === 1 && res.body.priceHistory.length === 1 && res.body.financeIncluded === true);

  res = fakeRes();
  await pull({ query: { financeSince: "garbage" }, user: user("owner") }, res, (e) => { throw e; });
  ok("invalid financeSince falls back to full pull instead of crashing", res.body.expenses.length === 1);
}

{
  // push: expenses + price history through the real handler
  const expStore = new Map();
  Expense.findOne = async ({ clientId }) => expStore.get(clientId) || null;
  Expense.create = async (doc) => {
    const saved = { ...doc, _id: new mongoose.Types.ObjectId(), updatedAt: new Date(), toObject() { return { ...this }; } };
    expStore.set(doc.clientId, saved);
    return saved;
  };
  const histStore = new Map();
  PriceHistory.findOne = async ({ clientId }) => histStore.get(clientId) || null;
  PriceHistory.create = async (doc) => {
    const saved = { ...doc, _id: new mongoose.Types.ObjectId() };
    histStore.set(doc.clientId, saved);
    return saved;
  };
  const pid = new mongoose.Types.ObjectId();
  // resolveProductRefs chains .session(...) onto Product.find(...)
  let productsExist = true;
  Product.find = () => ({ session: async () => (productsExist ? [{ _id: pid, clientId: "p-local", storeId: STORE }] : []) });

  const exp = { clientId: "ex1", amount: 5000, date: "2026-10-01T10:00:00Z", category: "Fuel" };
  const hist = { clientId: "hh1", productId: "p-local", productClientId: "p-local", field: "costPrice", oldValue: 100, newValue: 120, kind: "change", changedAt: "2026-10-01T09:00:00Z" };

  let res = fakeRes();
  await push({ body: { expenses: [exp], priceHistory: [hist] }, user: user("manager") }, res, (e) => { throw e; });
  ok("manager push accepts expense + price history", res.body.errors.length === 0 && res.body.expenses.length === 1 && res.body.priceHistory.length === 1);
  const row = histStore.get("hh1");
  ok("history row resolved to the real product _id", String(row.productId) === String(pid));
  ok("history changedBy is the AUTHENTICATED user, not client-supplied", row.changedBy === MANAGER);
  ok("history keeps the device's edit time", row.changedAt.toISOString() === "2026-10-01T09:00:00.000Z");

  res = fakeRes();
  await push({ body: { priceHistory: [hist] }, user: user("manager") }, res, (e) => { throw e; });
  ok("replayed history row is idempotent (no second row)", histStore.size === 1 && res.body.errors.length === 0 && res.body.priceHistory.length === 1);

  res = fakeRes();
  await push({ body: { priceHistory: [{ ...hist, clientId: "hh2", changedAt: "2099-01-01T00:00:00Z" }] }, user: user("owner") }, res, (e) => { throw e; });
  ok("future changedAt is clamped to now", histStore.get("hh2").changedAt.getTime() < Date.now() + 10_000);

  res = fakeRes();
  await push({ body: { priceHistory: [{ ...hist, clientId: "hh3", field: "weight" }] }, user: user("owner") }, res, (e) => { throw e; });
  ok("invalid field rejected with a readable message", res.body.errors.length === 1 && /Invalid price field/.test(res.body.errors[0].message));

  res = fakeRes();
  await push({ body: { priceHistory: [{ ...hist, clientId: "hh4", newValue: -3 }] }, user: user("owner") }, res, (e) => { throw e; });
  ok("negative price rejected", res.body.errors.length === 1);

  res = fakeRes();
  productsExist = false;
  await push({ body: { priceHistory: [{ ...hist, clientId: "hh5", productId: "ghost", productClientId: "ghost" }] }, user: user("owner") }, res, (e) => { throw e; });
  ok("unknown product -> readable 404-style error", res.body.errors.length === 1 && /wasn't found/.test(res.body.errors[0].message));

  productsExist = true; // so the cashier case fails on the ROLE check, not on a missing product
  res = fakeRes();
  await push({ body: { expenses: [{ ...exp, clientId: "ex-c" }], priceHistory: [{ ...hist, clientId: "hh-c" }] }, user: user("cashier") }, res, (e) => { throw e; });
  const types = res.body.errors.map((e) => e.type).sort();
  ok("CASHIER push: expense AND price history both rejected (no sync bypass)", types.join() === "expense,priceHistory", `got ${types}`);
  ok("...and neither was stored", !expStore.has("ex-c") && !histStore.has("hh-c"));
  ok("...with a user-readable reason", res.body.errors.every((e) => e.message.length > 0 && !/stack|at /i.test(e.message)));
  ok("...and the history rejection is specifically the role check", res.body.errors.find((e) => e.type === "priceHistory").message.includes("role"));

  res = fakeRes();
  await push({ body: { expenses: [{ ...exp, clientId: "ex-bad", amount: -1 }] }, user: user("owner") }, res, (e) => { throw e; });
  ok("invalid expense surfaces its validation message through sync", res.body.errors.length === 1 && /greater than 0/.test(res.body.errors[0].message));
}

// ------------------------------------------------ protect (auth middleware)
{
  process.env.JWT_SECRET = "test-secret";
  const token = jwt.sign({ userId: "u1" }, process.env.JWT_SECRET);
  const run = async (dbUser, store = { isActive: true }) => {
    User.findById = async () => dbUser;
    Store.findById = async () => store;
    const res = fakeRes();
    let nextArg = "NOT CALLED";
    await protect({ headers: { authorization: `Bearer ${token}` } }, res, (e) => { nextArg = e; });
    return { res, nextArg, req: null };
  };
  const base = { _id: new mongoose.Types.ObjectId(), isActive: true, role: "owner", name: "N", email: "n@x.rw" };

  let r = await run({ ...base, isPlatformAdmin: true }); // no storeId — the real crash
  ok("platform admin on a store route -> clean 403, not a TypeError 500", r.res.statusCode === 403 && r.nextArg instanceof Error && !(r.nextArg instanceof TypeError), String(r.nextArg));
  ok("...and the message points them to the admin panel", /admin panel/.test(r.nextArg?.message || ""));

  r = await run({ ...base, isPlatformAdmin: false });
  ok("a store account with no store -> clean 403", r.res.statusCode === 403 && /isn't linked to a store/.test(r.nextArg?.message || ""));

  const req = { headers: { authorization: `Bearer ${token}` } };
  User.findById = async () => ({ ...base, storeId: new mongoose.Types.ObjectId(STORE), isPlatformAdmin: false });
  Store.findById = async () => ({ isActive: true });
  let err = "NOT CALLED";
  await protect(req, fakeRes(), (e) => { err = e; });
  ok("a normal store user passes and gets a string storeId", err === undefined && req.user.storeId === STORE && req.user.role === "owner");

  r = await run({ ...base, storeId: new mongoose.Types.ObjectId(STORE), isPlatformAdmin: false }, { isActive: false });
  ok("a suspended store is still refused with 403", r.res.statusCode === 403 && /suspended/.test(r.nextArg?.message || ""));

  User.findById = async () => null;
  const res401 = fakeRes();
  await protect({ headers: { authorization: `Bearer ${token}` } }, res401, () => {});
  ok("unknown user -> 401", res401.statusCode === 401);
}

// ------------------------------------- resolveProductRefs and deleted products
{
  const { resolveProductRefs } = await import("../src/utils/productRef.js");
  const queries = [];
  Product.find = (q) => {
    queries.push(q);
    return { session: async () => [] };
  };
  const id = new mongoose.Types.ObjectId().toString();

  await resolveProductRefs(STORE, [id, "client-uuid"]);
  ok("by default, deleted products are excluded from BOTH lookups (objectId + clientId)", queries.length === 2 && queries.every((q) => JSON.stringify(q.isDeleted) === JSON.stringify({ $ne: true })), JSON.stringify(queries));

  queries.length = 0;
  await resolveProductRefs(STORE, [id, "client-uuid"], undefined, { includeDeleted: true });
  ok("includeDeleted:true removes the filter on both lookups", queries.length === 2 && queries.every((q) => !("isDeleted" in q)), JSON.stringify(queries));
}

// A sale must STILL resolve a deleted product: it records something that already happened.
{
  const seen = [];
  const pid = new mongoose.Types.ObjectId();
  Product.find = (q) => {
    seen.push(q);
    return { session: async () => [{ _id: pid, clientId: "p", name: "Gone item", quantityOnHand: 10, costPrice: 1, sellPrice: 2, async save() { return this; } }] };
  };
  mongoose.startSession = async () => ({ withTransaction: (fn) => fn(), endSession() {} });
  Sale.findOne = async () => null;
  Sale.create = async ([doc]) => [{ ...doc, _id: new mongoose.Types.ObjectId(), toObject() { return { ...this }; } }];
  StockMovement.insertMany = async () => [];
  await performSaleCreation(STORE, OWNER, { items: [{ productId: String(pid), quantity: 1 }] }, "owner");
  ok("a SALE still resolves soft-deleted products (offline revenue must not be lost)", seen.length > 0 && seen.every((q) => !("isDeleted" in q)), JSON.stringify(seen));
}

// ------------------------------------------- inviteTeammate duplicate email
{
  const { inviteTeammate } = await import("../src/controllers/authController.js");
  const call = async (existing, createImpl) => {
    User.findOne = async () => existing;
    User.hashPassword = async () => "hash";
    User.create = createImpl || (async (doc) => ({ ...doc, _id: new mongoose.Types.ObjectId(), toSafeJSON() { return { email: doc.email }; } }));
    const res = fakeRes();
    let err = null;
    await inviteTeammate({ body: { name: "T", email: "  Bob@Shop.RW ", password: "pw123456", role: "cashier" }, user: { storeId: STORE, id: OWNER } }, res, (e) => { err = e; });
    return { res, err };
  };

  let r = await call({ _id: "x" });
  ok("inviting an email that's already on the team -> friendly 409 (not a 500)", r.res.statusCode === 409 && /already/i.test(r.err?.message || ""), `${r.res.statusCode} ${r.err?.message}`);

  r = await call(null, async () => { throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 }); });
  ok("two people inviting the same email at once (race) -> the same friendly 409", r.res.statusCode === 409 && /already/i.test(r.err?.message || ""));

  r = await call(null);
  ok("a new email still works (201) with the email normalised", r.res.statusCode === 201 && r.err === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
