import AuditLog from "../models/AuditLog.js";

/**
 * Fire-and-forget audit record. Called from controllers after a mutation
 * commits successfully. Never throws into the request path — a logging
 * failure should not fail the user's action.
 */
export async function logAction({ storeId, userId, action, entityType, entityId, before, after, metadata }) {
  try {
    await AuditLog.create({ storeId, userId, action, entityType, entityId, before, after, metadata });
  } catch (err) {
    console.error("[audit] failed to write audit log:", err.message);
  }
}
