// Mirrors safeSyncErrorMessage's exact logic from syncController.js.

function safeSyncErrorMessage(err, context) {
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return err.message || "Rejected";
  }
  return "Couldn't process this — please try again, or contact support if it keeps happening.";
}

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) pass++;
  else { fail++; console.log("FAIL:", desc); }
}

// Deliberate validation errors — exactly the shape performSaleCreation,
// applyStockMovement, performCreatePurchaseOrder etc. throw.
check(
  "deliberate 400 (role gate) shown verbatim — this is the whole point of the recovery screen",
  safeSyncErrorMessage(Object.assign(new Error("role does not permit product changes"), { statusCode: 403 }), "product")
    === "role does not permit product changes"
);
check(
  "deliberate 400 (discount validation) shown verbatim",
  safeSyncErrorMessage(Object.assign(new Error("Discount (10000) cannot exceed subtotal (5000)"), { statusCode: 400 }), "sale")
    === "Discount (10000) cannot exceed subtotal (5000)"
);

// Genuinely unexpected — no statusCode at all (a raw thrown error from
// some unrelated library or a DB hiccup).
check(
  "unexpected error (no statusCode) — raw message NOT leaked",
  safeSyncErrorMessage(new Error("connect ETIMEDOUT 10.0.0.5:27017"), "product") !== "connect ETIMEDOUT 10.0.0.5:27017"
);
check(
  "unexpected error (no statusCode) — generic message shown instead",
  safeSyncErrorMessage(new Error("connect ETIMEDOUT 10.0.0.5:27017"), "product")
    === "Couldn't process this — please try again, or contact support if it keeps happening."
);

// A 500 explicitly set should also be treated as unexpected, not shown.
check(
  "explicit 500 statusCode — still treated as unexpected, not shown verbatim",
  safeSyncErrorMessage(Object.assign(new Error("Something broke internally"), { statusCode: 500 }), "product")
    !== "Something broke internally"
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
