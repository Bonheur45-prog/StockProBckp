/**
 * Adds the fields every offline-syncable collection needs:
 *
 * - clientId: a UUID generated on the device when the record is first
 *   created offline. Lets the client upsert idempotently (retrying a sync
 *   push after a dropped connection won't create duplicates).
 * - storeId: tenant scoping (added by each schema itself, required index).
 * - isDeleted: soft delete so deletions can propagate through sync instead
 *   of disappearing silently on other devices.
 * - syncVersion: bumped on every server-side write, used for
 *   last-write-wins conflict resolution during sync.
 * - updatedBy / createdBy: who did it, for the audit trail feature.
 */
export function syncablePlugin(schema) {
  schema.add({
    clientId: { type: String, index: true },
    isDeleted: { type: Boolean, default: false },
    syncVersion: { type: Number, default: 1 },
    createdBy: { type: "ObjectId", ref: "User" },
    updatedBy: { type: "ObjectId", ref: "User" },
  });

  schema.pre("save", function (next) {
    if (!this.isNew) {
      this.syncVersion += 1;
    }
    next();
  });
}
