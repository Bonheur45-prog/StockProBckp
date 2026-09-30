import jwt from "jsonwebtoken";
import asyncHandler from "express-async-handler";
import User from "../models/User.js";

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
