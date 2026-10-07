import asyncHandler from "express-async-handler";
import crypto from "crypto";
import mongoose from "mongoose";
import Expense, { EXPENSE_PAYMENT_METHODS, EXPENSE_FREQUENCIES } from "../models/Expense.js";
import Supplier from "../models/Supplier.js";
import { logAction } from "../utils/audit.js";

/**
 * Roles (decided with the product owner):
 *   - owner + manager can VIEW and ADD expenses (including "log this period's
 *     recurring expenses", which only ever adds new rows).
 *   - only the owner can EDIT or DELETE an existing expense. Money records
 *     are hard to undo, so rewriting history is owner-only.
 *
 * These checks live in the shared functions below, not just on the routes:
 * the offline sync push (syncController) calls performUpsertExpense directly
 * and would otherwise bypass any route-level requireRole.
 */
export const canLogExpenses = (role) => role === "owner" || role === "manager";
export const canEditExpenses = (role) => role === "owner";

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

/**
 * Validates + normalises incoming expense fields. `partial` = an update where
 * absent fields mean "leave as is"; otherwise a full record (all required
 * fields must be present). `current` is the existing document on updates, used
 * only to validate the recurring flag/frequency pair against what's stored.
 */
function cleanFields(input, { partial, current }) {
  const out = {};
  const has = (key) => input[key] !== undefined;

  if (!partial || has("amount")) {
    const amount = Number(input.amount);
    if (input.amount === "" || input.amount === null || !Number.isFinite(amount) || amount <= 0) {
      throw fail("Amount must be a number greater than 0");
    }
    out.amount = Math.round(amount * 100) / 100;
  }

  if (!partial || has("date")) {
    const date = new Date(input.date);
    if (!input.date || Number.isNaN(date.getTime())) throw fail("A valid date is required");
    const year = date.getUTCFullYear();
    if (year < 2000 || year > 2100) throw fail("That date looks wrong — please check the year");
    out.date = date;
  }

  if (!partial || has("category")) out.category = String(input.category ?? "").trim();
  if (!partial || has("description")) out.description = String(input.description ?? "").trim();

  if (!partial || has("paymentMethod")) {
    const method = input.paymentMethod ?? "cash";
    if (!EXPENSE_PAYMENT_METHODS.includes(method)) throw fail("Invalid payment method");
    out.paymentMethod = method;
  }

  if (has("receiptUrl")) out.receiptUrl = input.receiptUrl || undefined;
  if (has("receiptPublicId")) out.receiptPublicId = input.receiptPublicId || undefined;
  if (has("recurringSeriesId")) out.recurringSeriesId = input.recurringSeriesId || undefined;
  if (has("isDeleted")) out.isDeleted = !!input.isDeleted;

  // Recurring flag and frequency must agree — validated against the stored
  // value when only one of the two is being changed.
  const recurring = has("isRecurring") ? !!input.isRecurring : current?.isRecurring ?? false;
  if (recurring) {
    const frequency = has("frequency") ? input.frequency : current?.frequency;
    if (!EXPENSE_FREQUENCIES.includes(frequency)) throw fail("Choose monthly or weekly for a recurring expense");
    out.isRecurring = true;
    out.frequency = frequency;
  } else if (!partial || has("isRecurring")) {
    out.isRecurring = false;
    out.frequency = null;
  }

  return out;
}

/**
 * Same either-ObjectId-or-clientId resolution used for products and the
 * purchase-order supplier link: an expense created offline may reference a
 * supplier that hasn't synced yet. Unresolvable -> no link, but the expense
 * still saves (supplierName is the snapshot).
 */
async function resolveSupplier(storeId, ref) {
  if (!ref) return null;
  if (mongoose.Types.ObjectId.isValid(ref)) {
    const byId = await Supplier.findOne({ _id: ref, storeId });
    if (byId) return byId;
  }
  return Supplier.findOne({ storeId, clientId: ref });
}

async function supplierFields(storeId, input) {
  if (!input.supplierId) return { supplierId: null, supplierName: String(input.supplierName ?? "").trim() };
  const supplier = await resolveSupplier(storeId, input.supplierId);
  return {
    supplierId: supplier ? supplier._id : null,
    supplierName: supplier ? supplier.name : String(input.supplierName ?? "").trim(),
  };
}

/** Value equality that treats null/undefined alike and compares Dates/ObjectIds by value. */
function sameValue(a, b) {
  const norm = (v) => {
    if (v === undefined || v === null) return null;
    if (v instanceof Date) return v.getTime();
    if (typeof v === "object") return v.toString();
    return v;
  };
  return norm(a) === norm(b);
}

/**
 * Create-or-update an expense by clientId — shared by POST /api/expenses and
 * the sync push, so an expense recorded offline goes through exactly the same
 * validation and role rules as one recorded online.
 *
 *  - New clientId: any owner/manager may create.
 *  - Known clientId, nothing actually different: returned as-is (this is what
 *    makes a retried push after a dropped connection a safe no-op, for any role).
 *  - Known clientId, content differs: that is an EDIT -> owner only, and
 *    applied only if the device's updatedAt is newer (same last-write-wins
 *    rule as products/suppliers).
 */
export async function performUpsertExpense(storeId, userId, userRole, payload) {
  if (!canLogExpenses(userRole)) throw fail("Your role can't record expenses", 403);

  const clientId = payload.clientId || crypto.randomUUID();
  const existing = await Expense.findOne({ storeId, clientId });

  if (!existing) {
    const fields = cleanFields(payload, { partial: false });
    Object.assign(fields, await supplierFields(storeId, payload));
    // A non-owner can't create an already-deleted record (deleting is owner-only).
    if (!canEditExpenses(userRole)) delete fields.isDeleted;
    if (fields.isRecurring && !fields.recurringSeriesId) fields.recurringSeriesId = clientId;

    const created = await Expense.create({ ...fields, storeId, clientId, createdBy: userId, updatedBy: userId });
    await logAction({
      storeId, userId, action: "expense.create", entityType: "Expense", entityId: created._id, after: created.toObject(),
    });
    return created;
  }

  const fields = cleanFields(payload, { partial: false, current: existing });
  Object.assign(fields, await supplierFields(storeId, payload));
  if (fields.isRecurring && !fields.recurringSeriesId) fields.recurringSeriesId = existing.recurringSeriesId || clientId;
  if (fields.isDeleted === undefined) fields.isDeleted = existing.isDeleted;

  const changed = Object.keys(fields).filter((key) => !sameValue(existing[key], fields[key]));
  if (changed.length === 0) return existing;

  if (!canEditExpenses(userRole)) throw fail("Only the owner can edit or delete an expense", 403);

  const clientUpdatedAt = payload.updatedAt ? new Date(payload.updatedAt) : null;
  if (!clientUpdatedAt || !(clientUpdatedAt > existing.updatedAt)) return existing; // stale edit — server copy is newer

  const before = existing.toObject();
  Object.assign(existing, fields);
  existing.updatedBy = userId;
  await existing.save();

  await logAction({
    storeId,
    userId,
    action: fields.isDeleted && !before.isDeleted ? "expense.delete" : "expense.update",
    entityType: "Expense",
    entityId: existing._id,
    before,
    after: existing.toObject(),
  });
  return existing;
}

// GET /api/expenses?from=&to=&category=
export const listExpenses = asyncHandler(async (req, res) => {
  const { from, to, category } = req.query;
  const query = { storeId: req.user.storeId, isDeleted: false };
  if (category) query.category = category;
  if (from || to) {
    query.date = {};
    if (from) query.date.$gte = new Date(from);
    if (to) query.date.$lt = new Date(to);
  }
  const items = await Expense.find(query).sort({ date: -1 });
  res.json(items);
});

// POST /api/expenses   (owner + manager)
export const createExpense = asyncHandler(async (req, res) => {
  try {
    const expense = await performUpsertExpense(req.user.storeId, req.user.id, req.user.role, req.body);
    res.status(201).json(expense);
  } catch (err) {
    res.status(err.statusCode || 500);
    throw err;
  }
});

// PUT /api/expenses/:id   (owner only)
export const updateExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, storeId: req.user.storeId, isDeleted: false });
  if (!expense) {
    res.status(404);
    throw new Error("Expense not found");
  }

  let fields;
  try {
    fields = cleanFields(req.body, { partial: true, current: expense });
    if (req.body.supplierId !== undefined) Object.assign(fields, await supplierFields(req.user.storeId, req.body));
  } catch (err) {
    res.status(err.statusCode || 500);
    throw err;
  }
  delete fields.isDeleted; // deleting has its own route

  const before = expense.toObject();
  Object.assign(expense, fields);
  expense.updatedBy = req.user.id;
  await expense.save();

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "expense.update",
    entityType: "Expense",
    entityId: expense._id,
    before,
    after: expense.toObject(),
  });

  res.json(expense);
});

// DELETE /api/expenses/:id   (owner only; soft delete so sync can propagate it)
export const deleteExpense = asyncHandler(async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, storeId: req.user.storeId });
  if (!expense) {
    res.status(404);
    throw new Error("Expense not found");
  }
  expense.isDeleted = true;
  expense.updatedBy = req.user.id;
  await expense.save();

  await logAction({
    storeId: req.user.storeId,
    userId: req.user.id,
    action: "expense.delete",
    entityType: "Expense",
    entityId: expense._id,
  });

  res.status(204).send();
});