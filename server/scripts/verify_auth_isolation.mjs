// Verifies the security hardening using the REAL controllers/middleware with
// only the Mongoose model I/O stubbed (no database needed).
// Run from server/:   node scripts/verify_auth_isolation.mjs

import jwt from "jsonwebtoken";
import mongoose from "mongoose";
process.env.JWT_SECRET = "x".repeat(40);

import User from "../src/models/User.js";
import Store from "../src/models/Store.js";
import Product from "../src/models/Product.js";
import AuditLog from "../src/models/AuditLog.js";
import { login, updateMe } from "../src/controllers/authController.js";
import { getPublicProduct } from "../src/controllers/publicController.js";
import { activityFeed } from "../src/controllers/reportController.js";
import { resetUserPassword } from "../src/controllers/adminController.js";
import { protect } from "../src/middleware/auth.js";
import { tokenPredatesPasswordChange } from "../src/utils/token.js";
import { parsePaging, parseDateParam } from "../src/utils/queryParams.js";
import { assertProductionConfig } from "../src/config/env.js";

let pass = 0, fail = 0;
const ok = (d, c) => (c ? pass++ : (fail++, console.log("FAIL:", d)));

function run(handler, req) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, body: undefined, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve({ res: this, err: null }); } };
    handler({ headers: {}, body: {}, query: {}, params: {}, ...req }, res, (err) => resolve({ res, err, nextCalled: !err }));
  });
}
const id = () => new mongoose.Types.ObjectId();

// ---- config / helpers ----
ok("prod config rejects missing secrets", (() => { try { assertProductionConfig({ NODE_ENV: "production" }); return false; } catch { return true; } })());
ok("prod config rejects short JWT secret", (() => { try { assertProductionConfig({ NODE_ENV: "production", JWT_SECRET: "short", CLIENT_ORIGINS: "https://a.b", MONGO_URI: "m" }); return false; } catch { return true; } })());
ok("prod config accepts good config", (() => { try { assertProductionConfig({ NODE_ENV: "production", JWT_SECRET: "y".repeat(40), CLIENT_ORIGINS: "https://a.b", MONGO_URI: "m" }); return true; } catch { return false; } })());
ok("dev config not enforced", (() => { try { assertProductionConfig({ NODE_ENV: "development" }); return true; } catch { return false; } })());
ok("paging caps limit", parsePaging({ limit: "99999" }).limit === 200);
ok("paging defaults on junk", parsePaging({ limit: "abc", page: "-4" }).limit === 50 && parsePaging({ page: "-4" }).page === 1);
ok("paging skip", parsePaging({ page: "3", limit: "10" }).skip === 20);
ok("date param invalid -> null", parseDateParam("not-a-date") === null && parseDateParam({ $gt: 1 }) === null);
ok("date param absent -> undefined", parseDateParam(undefined) === undefined);
ok("date param valid", parseDateParam("2026-01-02") instanceof Date);

// ---- token staleness ----
const changed = new Date();
const nowSec = Math.floor(changed.getTime() / 1000);
ok("old token predates change", tokenPredatesPasswordChange({ iat: nowSec - 100 }, changed));
ok("same-second token survives", !tokenPredatesPasswordChange({ iat: nowSec }, changed));
ok("no change recorded -> fine", !tokenPredatesPasswordChange({ iat: 1 }, undefined));

// ---- protect rejects stale token, accepts fresh ----
const storeId = id();
const userDoc = { _id: id(), isActive: true, storeId, role: "owner", passwordChangedAt: new Date(Date.now() + 5000) };
const origFindById = User.findById;
const realStoreFindById = Store.findById;
Store.findById = async () => ({ isActive: true });
User.findById = () => ({ select: () => userDoc, then: (r) => r(userDoc), populate: () => userDoc });
const staleTok = jwt.sign({ userId: String(userDoc._id) }, process.env.JWT_SECRET);
let r = await run(protect, { headers: { authorization: `Bearer ${staleTok}` } });
ok("stale token -> 401", r.res.statusCode === 401 && r.err);
userDoc.passwordChangedAt = new Date(Date.now() - 60000);
r = await run(protect, { headers: { authorization: `Bearer ${staleTok}` } });
ok("fresh token passes protect", r.nextCalled === true);
User.findById = origFindById;
Store.findById = realStoreFindById;

// ---- login ----
function fakeUser(over = {}) {
  return { _id: id(), email: "a@x.com", isActive: true, storeId: id(), isPlatformAdmin: false, comparePassword: async (p) => p === "rightpass1", save: async () => {}, toSafeJSON() { return { id: String(this._id) }; }, ...over };
}
const origFind = User.find, origStoreFindById = Store.findById, origStoreFindOne = Store.findOne;
Store.findById = async () => ({ _id: id(), isActive: true });
Store.findOne = async () => null;

User.find = async () => [];
r = await run(login, { body: { email: "no@x.com", password: "whatever1" } });
const unknown = r.res.statusCode + "|" + r.err?.message;
User.find = async () => [fakeUser()];
r = await run(login, { body: { email: "a@x.com", password: "wrongpass1" } });
ok("wrong password looks identical to unknown email", r.res.statusCode + "|" + r.err?.message === unknown);
r = await run(login, { body: { email: "a@x.com", password: "rightpass1" } });
ok("correct login returns token", !!r.res.body?.token);
r = await run(login, { body: { email: { $ne: "" }, password: "rightpass1" } });
ok("operator-injection email -> 400", r.res.statusCode === 400);
User.find = async () => [fakeUser(), fakeUser()];
r = await run(login, { body: { email: "a@x.com", password: "wrongpass1" } });
ok("multi-account + wrong password reveals nothing", r.res.statusCode + "|" + r.err?.message === unknown);
r = await run(login, { body: { email: "a@x.com", password: "rightpass1" } });
ok("multi-account + right password asks for store code", r.res.statusCode === 409);
User.find = origFind; Store.findById = origStoreFindById; Store.findOne = origStoreFindOne;

// ---- change password: stamps + fresh token + min length ----
const me = { _id: id(), name: "N", save: async function () {}, comparePassword: async (p) => p === "oldpass123", passwordHash: "h", toSafeJSON() { return { id: String(this._id) }; } };
User.findById = async () => me;
User.hashPassword = async (p) => "hash:" + p;
const auditCreate = AuditLog.create; AuditLog.create = async () => {};
r = await run(updateMe, { user: { id: me._id, storeId }, body: { currentPassword: "oldpass123", newPassword: "short" } });
ok("short new password rejected", r.res.statusCode === 400);
me.user = undefined;
r = await run(updateMe, { user: { id: me._id, storeId }, body: { currentPassword: "oldpass123", newPassword: "brandnewpass" } });
ok("password change stamps passwordChangedAt", me.passwordChangedAt instanceof Date);
ok("password change returns fresh token", typeof r.res.body?.token === "string");
r = await run(updateMe, { user: { id: me._id, storeId }, body: { newPassword: { $ne: 1 } } });
ok("object password -> 400", r.res.statusCode === 400);
User.findById = origFindById;

// ---- public endpoint: store-missing and product-missing are indistinguishable ----
Store.findOne = async () => null;
const a = await run(getPublicProduct, { params: { storeSlug: "nope", barcode: "1" } });
Store.findOne = async () => ({ _id: id(), name: "S" });
const origPF = Product.findOne; Product.findOne = async () => null;
const b = await run(getPublicProduct, { params: { storeSlug: "real", barcode: "1" } });
ok("public 404s identical", a.res.statusCode === 404 && b.res.statusCode === 404 && a.err.message === b.err.message);
Store.findOne = origStoreFindOne; Product.findOne = origPF;

// ---- activity feed: masks platform staff, caps limit, rejects bad dates ----
let seenQuery, seenLimit;
const origAF = AuditLog.find;
AuditLog.find = (q) => { seenQuery = q; const c = { sort: () => c, skip: () => c, limit: (n) => { seenLimit = n; return c; }, populate: async () => [
  { toObject: () => ({ action: "x", userId: { name: "Staff Person", role: "owner", isPlatformAdmin: true } }) },
  { toObject: () => ({ action: "y", userId: { name: "Cashier", role: "cashier", isPlatformAdmin: false } }) } ] }; return c; };
AuditLog.countDocuments = async () => 2;
r = await run(activityFeed, { user: { storeId }, query: { limit: "100000" } });
ok("feed scoped to own store", String(seenQuery.storeId) === String(storeId));
ok("feed limit capped", seenLimit === 200);
ok("platform staff name hidden from store", r.res.body.items[0].userId.name === "BrightLink support");
ok("normal staff still named", r.res.body.items[1].userId.name === "Cashier" && !("isPlatformAdmin" in r.res.body.items[1].userId));
r = await run(activityFeed, { user: { storeId }, query: { from: "garbage" } });
ok("bad date -> 400 not 500", r.res.statusCode === 400);
AuditLog.find = origAF;

// ---- admin reset: audit + stamp ----
const target = { _id: id(), name: "T", storeId, save: async () => {} };
User.findById = async () => target;
let logged;
AuditLog.create = async (d) => { logged = d; };
r = await run(resetUserPassword, { user: { _id: id() }, params: { id: "x" }, body: { newPassword: "longenough1" } });
ok("admin reset stamps passwordChangedAt", target.passwordChangedAt instanceof Date);
ok("admin reset audited in target store", logged?.action === "user.password_reset_by_support" && String(logged.storeId) === String(storeId));
ok("audit never holds the password", !JSON.stringify(logged).includes("longenough1"));
r = await run(resetUserPassword, { user: { _id: id() }, params: { id: "x" }, body: { newPassword: ["aaaaaaaaaa"] } });
ok("array password rejected", r.res.statusCode === 400);
User.findById = origFindById; AuditLog.create = auditCreate;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
