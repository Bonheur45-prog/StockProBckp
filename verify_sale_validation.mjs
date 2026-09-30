// Ad-hoc isolated test of the exact validation logic added to
// performSaleCreation() — reimplemented here as pure functions (no Mongo
// involved) so the arithmetic/edge cases can be asserted directly.

function validateDiscount(discount) {
  const discountNum = discount === undefined || discount === null ? 0 : Number(discount);
  if (!Number.isFinite(discountNum) || discountNum < 0) {
    throw new Error("Discount must be a non-negative number");
  }
  return discountNum;
}

function validateCatalogPrice(item, sellPrice, userRole) {
  const hasOverride = item.unitPrice !== undefined && item.unitPrice !== null;
  const unitPrice = hasOverride ? Number(item.unitPrice) : sellPrice;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error("Invalid price");
  }
  if (hasOverride && Math.abs(unitPrice - sellPrice) > 0.0001 && userRole === "cashier") {
    throw new Error("Only an owner or manager can override the price");
  }
  return unitPrice;
}

function checkDiscountVsSubtotal(discountNum, subtotal) {
  if (discountNum > subtotal) throw new Error("Discount cannot exceed subtotal");
}

let pass = 0, fail = 0;
function assert(desc, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.log(`FAIL: ${desc} -> ${e.message}`);
  }
}
function assertThrows(desc, fn, msgIncludes) {
  try {
    fn();
    fail++;
    console.log(`FAIL (did not throw): ${desc}`);
  } catch (e) {
    if (msgIncludes && !e.message.includes(msgIncludes)) {
      fail++;
      console.log(`FAIL (wrong message): ${desc} -> got "${e.message}"`);
    } else {
      pass++;
    }
  }
}

// --- discount validation ---
assert("discount 0 is valid", () => { if (validateDiscount(0) !== 0) throw new Error("bad"); });
assert("discount undefined defaults to 0", () => { if (validateDiscount(undefined) !== 0) throw new Error("bad"); });
assert("discount 500 is valid", () => { if (validateDiscount(500) !== 500) throw new Error("bad"); });
assertThrows("negative discount rejected", () => validateDiscount(-100), "non-negative");
assertThrows("NaN discount rejected", () => validateDiscount("not a number"), "non-negative");
assertThrows("Infinity discount rejected", () => validateDiscount(Infinity), "non-negative");

// --- catalog price / role override ---
assert("cashier, no override, uses catalog price", () => {
  const p = validateCatalogPrice({ unitPrice: undefined }, 5000, "cashier");
  if (p !== 5000) throw new Error("bad price " + p);
});
assert("cashier submits unitPrice equal to catalog price (no-op) — allowed", () => {
  const p = validateCatalogPrice({ unitPrice: 5000 }, 5000, "cashier");
  if (p !== 5000) throw new Error("bad price " + p);
});
assertThrows("cashier overriding price is rejected", () => validateCatalogPrice({ unitPrice: 4000 }, 5000, "cashier"), "owner or manager");
assert("manager overriding price is allowed", () => {
  const p = validateCatalogPrice({ unitPrice: 4000 }, 5000, "manager");
  if (p !== 4000) throw new Error("bad price " + p);
});
assert("owner overriding price is allowed", () => {
  const p = validateCatalogPrice({ unitPrice: 7000 }, 5000, "owner");
  if (p !== 7000) throw new Error("bad price " + p);
});
assertThrows("negative override price rejected regardless of role", () => validateCatalogPrice({ unitPrice: -100 }, 5000, "owner"), "Invalid price");
assertThrows("Infinity override price rejected", () => validateCatalogPrice({ unitPrice: Infinity }, 5000, "owner"), "Invalid price");
assertThrows("NaN override price rejected", () => validateCatalogPrice({ unitPrice: "abc" }, 5000, "owner"), "Invalid price");
assert("null unitPrice treated as no override (not a 0-price attempt)", () => {
  const p = validateCatalogPrice({ unitPrice: null }, 5000, "cashier");
  if (p !== 5000) throw new Error("bad price " + p);
});

// --- discount vs subtotal ---
assert("discount equal to subtotal is allowed (total = 0)", () => checkDiscountVsSubtotal(10000, 10000));
assert("discount less than subtotal is allowed", () => checkDiscountVsSubtotal(500, 10000));
assertThrows("discount greater than subtotal is rejected", () => checkDiscountVsSubtotal(10001, 10000), "exceed");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
