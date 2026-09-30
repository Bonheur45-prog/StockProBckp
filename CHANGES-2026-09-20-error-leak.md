# StockPro — Fix session, 2026-09-20 (raw server error leak)

## What was reported

A login attempt showed this directly in the sign-in form's error banner:

    getaddrinfo ENOTFOUND bonheurmongoo-shard-00-00.9ukep.mongodb.net

Described as "happens when you're offline" — but that's not what this
actually is. `Login.jsx` reads `err.response?.data?.message`, which axios
only populates when the server actually sent back an HTTP response. A
genuine client-side network failure (no connection at all) never reaches
that branch. So the request *did* reach the server — the **server**
couldn't resolve MongoDB Atlas's hostname (a DNS failure reaching the
cluster), and that raw driver-level error text got sent straight back to
the browser and displayed verbatim.

## The actual bug

`server/src/middleware/errorHandler.js` — the global catch-all — sent
`err.message` to the client for **every** error, with no distinction
between:
- A deliberate, expected validation message ("Invalid credentials",
  "Discount cannot exceed subtotal") — meant to be shown, that's the
  whole point of it.
- A genuinely unexpected error (a DB/network failure, a malformed
  document, a bug) — whose raw message can contain internal details
  (hostnames, driver internals, stack-adjacent info) that should never
  reach an end user.

Same pattern, separate code path: `syncController.js`'s `push()` handler
catches errors per-item across all 7 sync categories and pushes
`err.message` straight into the response body that feeds the "couldn't
sync" recovery screen — completely bypassing the global error handler
(these are caught locally in a loop, never propagated). An unexpected
error here (not the deliberate role/validation errors that screen is
built to show) would leak the same way, directly onto that screen.

## The fix

**`errorHandler.js`** — every deliberate error in this codebase already
follows one consistent convention: the code raising it explicitly calls
`res.status(4xx)` before throwing (confirmed across `auth.js`'s
`protect`/`requireRole`, and the `res.status(err.statusCode || 500)`
pattern in every controller that uses the shared create/action
functions). So by the time an error reaches the handler,
`res.statusCode` already says whether it was anticipated. Only a genuine
4xx is now treated as safe to show verbatim; anything else (including an
explicit 5xx) gets a generic message, with the real error logged
server-side via `console.error` for diagnosis.

**`syncController.js`** — added `safeSyncErrorMessage(err, context)`,
used at all 7 per-item catch sites. Different signal than the global
handler on purpose: these are plain try/catch blocks inside loops, never
touching Express's response object, so there's no `res.status()` call to
check. Instead it trusts `err.statusCode` directly — which is exactly
what the shared functions this file calls (`performSaleCreation`,
`applyStockMovement`, `performCreatePurchaseOrder`, etc.) already set via
`Object.assign(new Error(...), { statusCode: 400 })` for every deliberate
validation error. A 4xx `statusCode` → shown verbatim (this is the
mechanism the whole recovery screen depends on). Anything else → logged
server-side, generic message shown instead.

## Verified

- `verify_error_handler.mjs` — 9 assertions against the real
  `errorHandler` function directly (not a reimplementation): the exact
  reported scenario (unexpected error, no `res.status()` called) no
  longer leaks the Mongo hostname and gets the generic message instead;
  three different deliberate 4xx cases (401 invalid credentials, 400
  discount validation, 403 role gate) all still show their real message
  verbatim, exactly as before — this fix narrows what's unsafe, it
  doesn't touch what was already correct; and confirmed `err.statusCode`
  alone, without an actual `res.status()` call, is correctly **not**
  trusted (matching how every real controller in this codebase actually
  signals a deliberate error).
- Validated by reverting to the old code and re-running: reproduces the
  exact reported leak and 2 related failures. Restored, re-confirmed
  9/9.
- `verify_sync_error_message.mjs` — 5 assertions against the exact same
  logic as the real `safeSyncErrorMessage` (mirrored, since it's a
  module-private function): deliberate role-gate and discount-validation
  errors still shown verbatim (this is load-bearing — it's what the
  recovery screen displays), an unexpected error with no `statusCode`
  doesn't leak and gets the generic message, and an explicit 500 is also
  correctly treated as unexpected, not shown.
- Confirmed this fix doesn't break anything checking these messages
  elsewhere: `verify_push_role_gate.mjs` (from an earlier session) still
  passes — it checks error `type`/`clientId`, never the message text, so
  it was never coupled to this. The client (`SyncIssues.jsx`) was
  deliberately built to never parse these messages for logic, only
  display them — confirmed by re-reading that decision from when it was
  built; changing which cases show which message doesn't touch any
  client-side logic.
- `node --check` on both touched files, boot-tested the server.

**Still unverified, same standing gap as every fix this session:** I
cannot reproduce the actual DNS/Atlas connectivity failure itself (that's
your live infrastructure, not something this sandbox can touch) — only
confirm that *when* an unexpected error like it occurs, it no longer
reaches the user. If the underlying MongoDB connectivity issue is
ongoing, that's a separate, real infrastructure problem worth checking on
its own — this fix makes it fail safely, it doesn't make the database
reachable.
