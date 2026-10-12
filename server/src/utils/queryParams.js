// Small helpers so bad query strings produce a clean 400 (or a safe default)
// instead of a 500, and so no list endpoint can be asked for unbounded rows.

export const MAX_PAGE_SIZE = 200;

export function parsePaging(query, { defaultLimit = 50 } = {}) {
  let limit = Number.parseInt(query?.limit, 10);
  let page = Number.parseInt(query?.page, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
  if (!Number.isFinite(page) || page < 1) page = 1;
  limit = Math.min(limit, MAX_PAGE_SIZE);
  return { page, limit, skip: (page - 1) * limit };
}

// Returns a Date, undefined (param absent), or null (present but invalid).
export function parseDateParam(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
