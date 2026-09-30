import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Sale from "../models/Sale.js";
import CreditPayment from "../models/CreditPayment.js";
import { logAction } from "../utils/audit.js";

/**
 * Reduces a phone number to its digits and, for Rwanda's local format,
 * its international form — so "0788123456", "+250788123456", and
 * "078-812-3456" all resolve to the same customer instead of splitting
 * one person's credit history across several. Rwanda-specific by design
 * (this app's current stated scope), not a general E.164 normalizer.
 * IMPORTANT: kept byte-for-byte identical to the same function in
 * client/src/lib/repo.js — the two have no shared module to import from
 * across the client/server boundary, so a change to one without the
 * other would silently make the two sides group the same customer
 * differently.
 */
function normalizePhone(phone) {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return "250" + digits.slice(1);
  return digits;
}

function customerKey(name, phone) {
  return `${(name || "").trim().toLowerCase()}|${normalizePhone(phone)}`;
}

// GET /api/credit/balances
// Aggregates every completed credit sale minus every payment, grouped by
// customer. Only customers with an outstanding (or historical) balance show up.
export const customerBalances = asyncHandler(async (req, res) => {
  const storeId = new mongoose.Types.ObjectId(req.user.storeId);

  const [creditSales, payments] = await Promise.all([
    Sale.find({ storeId, paymentMethod: "credit", status: "completed" }, "customerName customerPhone total occurredAt"),
    CreditPayment.find({ storeId, isDeleted: false }, "customerName customerPhone amount createdAt"),
  ]);

  const byCustomer = new Map();

  for (const sale of creditSales) {
    const key = customerKey(sale.customerName, sale.customerPhone);
    const entry = byCustomer.get(key) || { customerName: sale.customerName || "Unnamed customer", customerPhone: sale.customerPhone || "", charged: 0, paid: 0, lastActivity: sale.occurredAt };
    entry.charged += sale.total;
    if (sale.occurredAt > entry.lastActivity) entry.lastActivity = sale.occurredAt;
    byCustomer.set(key, entry);
  }

  for (const payment of payments) {
    const key = customerKey(payment.customerName, payment.customerPhone);
    const entry = byCustomer.get(key) || { customerName: payment.customerName, customerPhone: payment.customerPhone || "", charged: 0, paid: 0, lastActivity: payment.createdAt };
    entry.paid += payment.amount;
    if (payment.createdAt > entry.lastActivity) entry.lastActivity = payment.createdAt;
    byCustomer.set(key, entry);
  }

  const balances = [...byCustomer.values()]
    .map((e) => ({
      ...e,
      charged: Math.round(e.charged * 100) / 100,
      paid: Math.round(e.paid * 100) / 100,
      balance: Math.round((e.charged - e.paid) * 100) / 100,
    }))
    .sort((a, b) => b.balance - a.balance);

  res.json(balances);
});

// GET /api/credit/payments?customerName=&customerPhone=
export const listPayments = asyncHandler(async (req, res) => {
  const { customerName, customerPhone } = req.query;
  const query = { storeId: req.user.storeId, isDeleted: false };
  if (customerName) query.customerName = customerName;
  if (customerPhone) query.customerPhone = customerPhone;

  const payments = await CreditPayment.find(query).sort({ createdAt: -1 });
  res.json(payments);
});

/**
 * Core credit-payment recording logic, reused by the direct route and the
 * offline sync push handler. Idempotent on clientId.
 */
export async function performRecordPayment(storeId, userId, payload) {
  const { customerName, customerPhone, amount, note, clientId } = payload;

  if (!customerName || !amount || Number(amount) <= 0) {
    throw Object.assign(new Error("customerName and a positive amount are required"), { statusCode: 400 });
  }

  if (clientId) {
    const existing = await CreditPayment.findOne({ storeId, clientId });
    if (existing) return existing;
  }

  const payment = await CreditPayment.create({
    storeId,
    customerName,
    customerPhone: customerPhone || "",
    amount: Number(amount),
    note,
    clientId,
    createdBy: userId,
    updatedBy: userId,
  });

  await logAction({
    storeId,
    userId,
    action: "credit.payment",
    entityType: "CreditPayment",
    entityId: payment._id,
    after: payment.toObject(),
  });

  return payment;
}

// POST /api/credit/payments  { customerName, customerPhone, amount, note, clientId }
export const recordPayment = asyncHandler(async (req, res) => {
  try {
    const payment = await performRecordPayment(req.user.storeId, req.user.id, req.body);
    res.status(201).json(payment);
  } catch (err) {
    res.status(err.statusCode || 500);
    throw err;
  }
});
