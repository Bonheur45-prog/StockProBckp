import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/User.js";
import Store from "../models/Store.js";

export const protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401);
    throw new Error("Not authenticated");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    res.status(401);
    throw new Error("Invalid or expired token");
  }

  const user = await User.findById(decoded.userId);
  if (!user || !user.isActive) {
    res.status(401);
    throw new Error("Account not found or deactivated");
  }

  // A platform admin (or any account with no store) has nothing to scope a
  // store route by. Without this guard the req.user block below crashed on
  // user.storeId.toString() and answered 500 — so an admin who ended up in
  // the store app got a broken screen instead of a clear message.
  if (!user.storeId) {
    res.status(403);
    throw new Error(
      user.isPlatformAdmin
        ? "Platform admin accounts can't use the store app. Use the admin panel at /admin."
        : "This account isn't linked to a store. Contact support."
    );
  }

  // Checked on every request, not just at login — a JWT is valid for days,
  // so an admin suspending a store should cut off access immediately, not
  // whenever that person's token happens to expire. This costs one extra
  // lookup per request; worth it for a suspend action to actually mean
  // "now" at this app's scale.
  if (!user.isPlatformAdmin) {
    const store = await Store.findById(user.storeId);
    if (!store || !store.isActive) {
      res.status(403);
      throw new Error("This store has been suspended. Contact support for help.");
    }
  }

  // req.user drives every tenant-scoping query in the app: all data access
  // is filtered by req.user.storeId, never by a storeId the client sends.
  req.user = {
    id: user._id.toString(),
    storeId: user.storeId.toString(),
    role: user.role,
    name: user.name,
    email: user.email,
  };

  next();
});

/** Restricts a route to a platform-admin account — completely separate
 * from the store-scoped protect above, since an admin has no storeId to
 * scope anything by. */
export const protectAdmin = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    res.status(401);
    throw new Error("Not authenticated");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    res.status(401);
    throw new Error("Invalid or expired token");
  }

  const user = await User.findById(decoded.userId);
  if (!user || !user.isActive || !user.isPlatformAdmin) {
    res.status(403);
    throw new Error("Not authorized as a platform admin");
  }

  req.admin = { id: user._id.toString(), name: user.name, email: user.email };
  next();
});

/**
 * Restricts a route to specific roles, e.g. requireRole("owner", "manager").
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403);
      return next(new Error("You don't have permission to do that"));
    }
    next();
  };
}