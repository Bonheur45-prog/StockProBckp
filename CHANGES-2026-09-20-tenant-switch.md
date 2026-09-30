# StockPro — Fix session, 2026-09-20 (tenant-switch data leak)

## What was asked

Fix the tenant-switch data leak, flagged early in the audit and confirmed
real, but never actually patched: a 401 clears `token` and `user` from
localStorage; `AuthContext`'s `persist()` detects a store switch by
comparing against that same `user` key; if it's already gone, the switch
goes undetected, `clearLocalData()` never runs, and the old store's dirty
records can ride along into the new store's session (the server trusts
whatever storeId the new token carries, not what's in the record body).

## What tracing it fully turned up — three related bugs, not one

**1. The bug as diagnosed.** Confirmed exactly as described above, still
unpatched.

**2. A deeper race, found while designing the fix.** `initSyncLoop()`
(`main.jsx`) runs a 30-second background sync **unconditionally at app
boot, independent of auth state** — it's never stopped or restarted based
on who's logged in. Neither `persist()` nor `clearLocalData()` coordinate
with an in-flight sync at all. So a background push can already be
mid-flight — having read Store A's dirty records into memory, not yet
sent to the server — exactly when a login to Store B completes. By the
time that in-flight request actually reaches the network, it carries
Store A's data under Store B's now-active token. Fixing only #1 doesn't
close this: it fixes "the cache survives a switch," not "a sync was
already running when the switch happened."

**3. Found in code from an earlier session.** `listStuckRecords()` (and
the pre-existing `pendingChangeCount()`, whose pattern it copied) queried
dirty records across every table with **no storeId filter at all** —
violating this codebase's own stated rule that every local read must
filter by store. If two stores' data ever did coexist locally (precisely
what this whole fix is about), the "Couldn't sync" recovery screen built
last session would show — and let someone act on — another store's stuck
records.

## What changed

**`client/src/context/AuthContext.jsx`** — `persist()`'s switch detection
now uses a dedicated `lastStoreId` localStorage key instead of comparing
against `user`. Set only by `persist()`, touched by nothing else
(specifically: not the 401 interceptor), so it can't be silently broken
again by some future, unrelated change to what auth-error-handling
clears.

**`client/src/lib/sync.js`:**
- `pushDirty()` and `pullChanges()` each capture the authenticated
  store's id at the start (`currentAuthedStoreId()`, a small local
  duplicate of repo.js's own helper — importing the real one would create
  a circular dependency, since repo.js already imports from this file)
  and re-check it immediately before their reconcile-write step. If it
  changed mid-flight, they return without writing anything. The new
  session's own `runSync()` (already triggered by its own login) covers
  pushing/pulling its correct data separately.
- `listStuckRecords()` and `pendingChangeCount()` now filter by the
  current store's id, matching every other read in the codebase.
- `discardStuckRecord()` additionally refuses to act on a record whose
  `storeId` doesn't match the current session — belt-and-suspenders
  alongside `listStuckRecords()`'s own filtering, since the recovery
  screen only polls every 5s and could theoretically still be holding a
  just-stale entry.

**Known, unavoidable limitation:** none of this retroactively repairs a
device that was already affected before this fix ships — there's no
reliable marker distinguishing "this cached record's storeId is wrong"
after the fact. A device suspected of already having mixed data needs a
manual local data clear; nothing in this patch can detect and fix that on
its own.

## A test-infrastructure bug found and fixed while verifying this

Writing a real test for the mid-flight-switch guard (rather than settling
for "traced it by hand, seems right") surfaced something that had nothing
to do with the fix itself: **`navigator.onLine` was `undefined` in every
test in this suite, in every file, the entire time.** `setup.js`'s guard
(`if (typeof navigator === "undefined")`) never actually fired, because
Node 21+ defines its own minimal built-in `navigator` global with no
`onLine` property — so the guard's premise was already false before this
session ever touched the file. `runSync()`'s own `if (!navigator.onLine)
return` guard was therefore always true in tests, silently short-circuiting
before doing anything.

This went unnoticed because every test file until now either used the
global `sync.js` mock (where `runSync` is a no-op stub — this never
mattered) or triggered `runSync()` fire-and-forget without checking
whether it actually ran. `tenantSwitch.test.js` is the first test that
needed `runSync()` to genuinely execute, and the first time this
mattered. Fixed by setting `navigator.onLine = true` unconditionally
rather than gating it on a `typeof` check that no longer reflects
reality.

## Verified

- `verify_tenant_switch_fix.mjs` (included at the repo root) — mirrors
  `persist()`'s exact localStorage decision logic in isolation (can't be
  tested directly since it's inside a React hook and this project has no
  jsdom/component-testing setup). Six assertions, including reproducing
  the OLD buggy logic explicitly and confirming it fails the exact
  regression scenario (401 → switch to a different store → should clear,
  old logic silently skips it), then confirming the new logic handles all
  cases correctly including that same scenario.
- New `client/src/lib/__tests__/tenantSwitch.test.js` — 6 tests against
  the real `sync.js` (network boundary mocked, not the whole module, same
  pattern as `syncIssues.test.js`). Covers: storeId filtering on
  `listStuckRecords`/`pendingChangeCount`, `discardStuckRecord` refusing a
  cross-store record, and — the one that actually matters — a push and a
  pull each triggered to switch stores at the exact moment they make their
  network call (not just "sometime during the test"; synchronized via the
  mock's own implementation so the timing claim is real, not assumed),
  confirming neither reconciles stale data into the wrong store's cache,
  plus a same-store control case confirming the guard doesn't over-fire.
- **Validated by deliberately getting the test timing wrong first, and
  catching it via a debug pass rather than trusting a passing result**: an
  earlier version of the pull test synchronized the switch too early
  (relative to the test code's own synchronous execution, not relative to
  when `pullChanges()` actually starts, which happens only after
  `pushDirty()` fully resolves its own network call first) and would have
  passed even with the guard code deleted — caught by adding a control
  case ("guard shouldn't over-fire on a same-store completion") that
  failed for an unrelated reason (the `navigator.onLine` bug above),
  which is what led to finding both issues.
- Then validated the real thing: temporarily disabled both guards in
  `sync.js`, confirmed the exact 2 relevant tests failed — with real
  cross-tenant data actually appearing in the wrong store's local
  database, not just a mismatched flag — restored the guards, confirmed
  6/6 pass.
- Full suite: 55/55 across all 6 files. `oxlint`: 0 errors (3 warnings,
  all pre-existing, none new). `npm run build`: clean.

**Still unverified, same standing gap as every fix this session:** no
live-Mongo round-trip, and no way to test `AuthContext.jsx`'s `persist()`
wired into the actual React hook (no component-testing infrastructure
exists in this project — flagged before, still true). The standalone
script proves the decision logic is correct in isolation; it doesn't
prove the hook calls it correctly end to end. Please do a real two-store,
two-login hands-on pass — including the specific 401-then-switch sequence
this whole fix targets — before considering this closed.
