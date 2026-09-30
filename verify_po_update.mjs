// Traces the exact interaction I reasoned through by hand: a PO that's
// both edited (status/notes) AND received against in the SAME push cycle,
// confirming (a) the edit reaches the mock "server", (b) items/
// quantityReceived is never touched by the edit path, only by the receipt
// path, and (c) the receipt path's authoritative recompute is what wins,
// since it runs second in push()'s category order.

const PO_EDITABLE_FIELDS = ["status", "notes", "expectedDate", "supplierName"];

// Minimal mock of the two server functions' relevant behavior.
function applyPurchaseOrderUpdate(existing, payload) {
  if (new Date(payload.updatedAt) > new Date(existing.updatedAt)) {
    for (const field of PO_EDITABLE_FIELDS) {
      if (payload[field] !== undefined) existing[field] = payload[field];
    }
    existing.updatedAt = "2026-09-16T10:05:01.000Z"; // mongoose would bump this
  }
  return existing;
}

function applyReceipt(existing, receiptQuantity) {
  const line = existing.items[0];
  line.quantityReceived += receiptQuantity;
  const allReceived = existing.items.every((i) => i.quantityReceived >= i.quantityOrdered);
  const anyReceived = existing.items.some((i) => i.quantityReceived > 0);
  existing.status = allReceived ? "received" : anyReceived ? "partially_received" : existing.status;
  existing.updatedAt = "2026-09-16T10:05:02.000Z";
  return existing;
}

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) pass++;
  else { fail++; console.log("FAIL:", desc); }
}

// Server state before this push cycle.
const serverPO = {
  clientId: "po1",
  status: "ordered",
  notes: "",
  updatedAt: "2026-09-16T10:00:00.000Z",
  items: [{ productId: "p1", quantityOrdered: 20, quantityReceived: 0 }],
};

// What the client's dirty db.purchaseOrders row looks like at push time —
// it's the SAME local record used for the "receive" optimistic write, so
// it already has status locally bumped to "partially_received" AND a
// notes edit the user made moments earlier, in the same offline session.
const clientDirtyPO = {
  clientId: "po1",
  status: "partially_received", // client's own optimistic guess
  notes: "left at the back counter",
  expectedDate: undefined,
  supplierName: undefined,
  updatedAt: "2026-09-16T10:05:00.000Z",
  items: [{ productId: "p1", quantityOrdered: 20, quantityReceived: 8 }], // MUST be ignored by the update branch
};

// push() processes `purchaseOrders` (the generic update) BEFORE
// `poReceipts` (the dedicated receipt) — replicate that order exactly.
applyPurchaseOrderUpdate(serverPO, clientDirtyPO);
check("notes edit reached the server", serverPO.notes === "left at the back counter");
check("items was NOT touched by the update branch (still 0 received)", serverPO.items[0].quantityReceived === 0);

applyReceipt(serverPO, 8);
check("receipt applied exactly once (8, not 16)", serverPO.items[0].quantityReceived === 8);
check("status ends authoritative (from the receipt recompute, not the client's earlier guess)", serverPO.status === "partially_received");

// Now the case with NO concurrent receipt — a pure cancel.
const serverPO2 = { clientId: "po2", status: "ordered", notes: "", updatedAt: "2026-09-16T10:00:00.000Z", items: [{ productId: "p1", quantityOrdered: 5, quantityReceived: 0 }] };
const cancelPayload = { status: "cancelled", updatedAt: "2026-09-16T10:05:00.000Z" };
applyPurchaseOrderUpdate(serverPO2, cancelPayload);
check("cancel reaches the server (this was the original bug — it never did)", serverPO2.status === "cancelled");

// Stale update (older timestamp than what's already on the server) must be skipped.
const serverPO3 = { clientId: "po3", status: "ordered", notes: "server-set note", updatedAt: "2026-09-16T12:00:00.000Z" };
applyPurchaseOrderUpdate(serverPO3, { status: "cancelled", updatedAt: "2026-09-16T10:05:00.000Z" }); // T1 < T5
check("a stale update is skipped, not applied", serverPO3.status === "ordered" && serverPO3.notes === "server-set note");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
