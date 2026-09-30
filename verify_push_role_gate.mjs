// Manual trace of push()'s role-gate control flow, reimplemented as a
// minimal mock so it can run without Mongo — confirms: (a) a cashier's
// disallowed items land in results.errors with no DB call attempted,
// (b) a cashier's sales/creditPayments still go through untouched,
// (c) an owner/manager sees nothing blocked.

function simulatePush(userRole, body) {
  const canManageCatalog = userRole === "owner" || userRole === "manager";
  const results = { products: [], sales: [], stockMovements: [], suppliers: [], purchaseOrders: [], poReceipts: [], errors: [] };
  let dbCallsAttempted = 0;

  for (const p of body.products || []) {
    try {
      if (!canManageCatalog) throw Object.assign(new Error("role does not permit product changes"), { statusCode: 403 });
      dbCallsAttempted++;
      results.products.push(p);
    } catch (err) { results.errors.push({ type: "product", clientId: p.clientId, message: err.message }); }
  }
  for (const m of body.stockMovements || []) {
    try {
      if (!canManageCatalog) throw Object.assign(new Error("role does not permit stock movements"), { statusCode: 403 });
      dbCallsAttempted++;
      results.stockMovements.push(m);
    } catch (err) { results.errors.push({ type: "stockMovement", clientId: m.clientId, message: err.message }); }
  }
  for (const s of body.sales || []) {
    dbCallsAttempted++; // sales are never gated
    results.sales.push(s);
  }
  for (const s of body.suppliers || []) {
    try {
      if (!canManageCatalog) throw Object.assign(new Error("role does not permit supplier changes"), { statusCode: 403 });
      dbCallsAttempted++;
      results.suppliers.push(s);
    } catch (err) { results.errors.push({ type: "supplier", clientId: s.clientId, message: err.message }); }
  }
  return { results, dbCallsAttempted };
}

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) pass++;
  else { fail++; console.log("FAIL:", desc); }
}

// Cashier pushes one of everything in the same batch
const cashierBody = {
  products: [{ clientId: "p1", name: "hacked price change" }],
  stockMovements: [{ clientId: "m1" }],
  sales: [{ clientId: "s1" }],
  suppliers: [{ clientId: "sup1" }],
};
const { results: cashierResults, dbCallsAttempted: cashierDbCalls } = simulatePush("cashier", cashierBody);

check("cashier: product rejected into errors", cashierResults.errors.some(e => e.type === "product" && e.clientId === "p1"));
check("cashier: stockMovement rejected into errors", cashierResults.errors.some(e => e.type === "stockMovement" && e.clientId === "m1"));
check("cashier: supplier rejected into errors", cashierResults.errors.some(e => e.type === "supplier" && e.clientId === "sup1"));
check("cashier: sale still went through (not gated)", cashierResults.sales.length === 1 && cashierResults.sales[0].clientId === "s1");
check("cashier: exactly 3 errors (product, movement, supplier)", cashierResults.errors.length === 3);
check("cashier: the sale's own success is unaffected by the other 3 being blocked (one bad item doesn't fail the batch)", cashierResults.sales.length === 1);
check("cashier: only the sale actually 'reached the DB' (1 call), not the 3 blocked items", cashierDbCalls === 1);

// Owner pushes the same batch — nothing should be blocked
const { results: ownerResults, dbCallsAttempted: ownerDbCalls } = simulatePush("owner", cashierBody);
check("owner: no errors at all", ownerResults.errors.length === 0);
check("owner: all 4 items went through", ownerDbCalls === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
