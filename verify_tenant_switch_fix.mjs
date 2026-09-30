// Mirrors persist()'s exact localStorage read/write sequence (minus the
// React state setters and the real network/clearLocalData calls, which
// can't be exercised outside a rendered component) so the actual decision
// logic — "does clearLocalData get called or not" — can be asserted
// directly, including the specific regression this fix targets: a 401
// happened (removing "user"), then a login to a DIFFERENT store, should
// still clear, which the old "user"-based check silently failed to do.

function makeStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = v; },
    removeItem: (k) => { delete store[k]; },
    _dump: () => ({ ...store }),
  };
}

// OLD (buggy) logic, for comparison.
function oldPersistDecision(localStorage, userObj) {
  const previousRaw = localStorage.getItem("user");
  const previousUser = previousRaw ? JSON.parse(previousRaw) : null;
  const willClear = !!(previousUser && previousUser.storeId !== userObj.storeId);
  localStorage.setItem("user", JSON.stringify(userObj));
  return willClear;
}

// NEW (fixed) logic.
function newPersistDecision(localStorage, userObj) {
  const previousStoreId = localStorage.getItem("lastStoreId");
  const willClear = !!(previousStoreId && previousStoreId !== String(userObj.storeId));
  localStorage.setItem("lastStoreId", String(userObj.storeId));
  localStorage.setItem("user", JSON.stringify(userObj));
  return willClear;
}

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) pass++;
  else { fail++; console.log("FAIL:", desc); }
}

// --- Baseline cases both old and new logic must get right ---
{
  const ls = makeStorage();
  check("fresh device, first ever login: no clear (nothing to clear)", newPersistDecision(ls, { storeId: "A" }) === false);
}
{
  const ls = makeStorage();
  newPersistDecision(ls, { storeId: "A" });
  check("same store re-authenticating (token refresh): no clear", newPersistDecision(ls, { storeId: "A" }) === false);
}
{
  const ls = makeStorage();
  newPersistDecision(ls, { storeId: "A" });
  check("genuine switch, normal case (no 401 involved): clears", newPersistDecision(ls, { storeId: "B" }) === true);
}

// --- The actual regression this fix targets ---
{
  const ls = makeStorage();
  newPersistDecision(ls, { storeId: "A" }); // logged in as store A
  ls.removeItem("token");
  ls.removeItem("user"); // simulates the 401 interceptor firing
  check(
    "OLD logic: 401 then switching to a DIFFERENT store — BUG, silently skips the clear",
    oldPersistDecision(ls, { storeId: "B" }) === false
  );
}
{
  const ls = makeStorage();
  newPersistDecision(ls, { storeId: "A" });
  ls.removeItem("token");
  ls.removeItem("user"); // 401 interceptor — "lastStoreId" is untouched by it
  check(
    "NEW logic: 401 then switching to a DIFFERENT store — correctly clears",
    newPersistDecision(ls, { storeId: "B" }) === true
  );
}
{
  const ls = makeStorage();
  newPersistDecision(ls, { storeId: "A" });
  ls.removeItem("token");
  ls.removeItem("user"); // 401 interceptor
  check(
    "NEW logic: 401 then re-authenticating to the SAME store — correctly does NOT clear (no lost drafts)",
    newPersistDecision(ls, { storeId: "A" }) === false
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
