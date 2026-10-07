import { describe, it, expect, vi } from "vitest";
import { buildPurchaseOrderPdf, computePoTotals, poReference, printPurchaseOrder, sharePurchaseOrder } from "../poPdf.js";

const store = { name: "Kigali Hardware", currency: "RWF", address: "KN 4 Ave 12", phone: "0788 000 111" };
const supplier = { name: "Acme Cement", phone: "0788 222 333", email: "sales@acme.rw", address: "Industrial Zone, Kigali" };

const order = (over = {}) => ({
  clientId: "c0ffee11-aaaa-bbbb-cccc-1234567890ab",
  status: "ordered",
  supplierName: "Acme Cement",
  createdAt: "2026-10-06T08:00:00.000Z",
  notes: "Deliver before Friday",
  items: [
    { name: "Cement 50kg", quantityOrdered: 20, quantityReceived: 0, unitCost: 12500 },
    { name: "Binding wire", quantityOrdered: 3, quantityReceived: 0, unitCost: 4000.5 },
  ],
  ...over,
});

// jsPDF writes page text uncompressed, so what the supplier would read is searchable in the output.
const text = (doc) => doc.output();

describe("computePoTotals", () => {
  // 20 × 12,500 = 250,000 ; 3 × 4,000.50 = 12,001.50 ; total 262,001.50  (worked by hand)
  it("multiplies quantity by unit cost and totals the order", () => {
    const t = computePoTotals(order());
    expect(t.lines.map((l) => l.lineTotal)).toEqual([250000, 12001.5]);
    expect(t.total).toBe(262001.5);
    expect(t.unpricedCount).toBe(0);
  });

  it("an item with no agreed price is null (not 0), is counted, and stays out of the total", () => {
    const t = computePoTotals(order({ items: [{ name: "A", quantityOrdered: 2, unitCost: 100 }, { name: "B", quantityOrdered: 5, unitCost: 0 }, { name: "C", quantityOrdered: 1 }] }));
    expect(t.lines[1]).toMatchObject({ unitCost: null, lineTotal: null });
    expect(t.unpricedCount).toBe(2);
    expect(t.total).toBe(200);
  });

  it("handles string numbers and fractional quantities", () => {
    expect(computePoTotals(order({ items: [{ name: "Pipe", quantityOrdered: "2.5", unitCost: "100" }] })).total).toBe(250);
  });

  it("detects received quantities", () => {
    expect(computePoTotals(order()).anyReceived).toBe(false);
    expect(computePoTotals(order({ items: [{ name: "A", quantityOrdered: 5, quantityReceived: 2, unitCost: 1 }] })).anyReceived).toBe(true);
  });
});

describe("poReference", () => {
  it("is derived from the clientId, so it's identical before and after sync", () => {
    expect(poReference(order())).toBe("PO-7890AB");
    expect(poReference(order({ id: "mongoid" }))).toBe("PO-7890AB");
  });
});

describe("the PDF itself", () => {
  const { doc, filename, reference, total } = buildPurchaseOrderPdf({ order: order(), store, supplier });
  const pdf = text(doc);

  it("is a real PDF with a readable name", () => {
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(filename).toBe("PO-7890AB-Acme-Cement.pdf");
    expect(reference).toBe("PO-7890AB");
  });

  it("prints the items, quantities, UNIT COSTS and line totals", () => {
    for (const expected of ["Cement 50kg", "Binding wire", "12,500 RWF", "250,000 RWF", "4,000.5 RWF", "12,001.5 RWF"]) {
      expect(pdf).toContain(expected);
    }
  });

  it("prints the order total", () => {
    expect(total).toBe(262001.5);
    expect(pdf).toContain("262,001.5 RWF");
  });

  it("identifies the store and supplier with real contact details", () => {
    for (const expected of ["Kigali Hardware", "KN 4 Ave 12", "0788 000 111", "Acme Cement", "sales@acme.rw", "Industrial Zone, Kigali", "PURCHASE ORDER", "PO-7890AB"]) {
      expect(pdf).toContain(expected);
    }
  });

  it("carries the notes and asks the supplier to send updated prices", () => {
    expect(pdf).toContain("Deliver before Friday");
    expect(pdf).toContain("send the updated prices with the delivery");
  });

  it("has no Received column when nothing has been received", () => {
    expect(pdf).not.toContain("Received");
  });

  it("adds a Received column for a partially received order", () => {
    const partial = buildPurchaseOrderPdf({ order: order({ status: "partially_received", items: [{ name: "Cement 50kg", quantityOrdered: 20, quantityReceived: 8, unitCost: 12500 }] }), store, supplier });
    expect(text(partial.doc)).toContain("Received");
  });

  it("shows — (not 0) for an unpriced item and says it is excluded from the total", () => {
    const unpriced = buildPurchaseOrderPdf({ order: order({ items: [{ name: "Mystery bolt", quantityOrdered: 4, unitCost: 0 }, { name: "Cement 50kg", quantityOrdered: 1, unitCost: 100 }] }), store, supplier });
    const t = text(unpriced.doc);
    expect(t).toContain("Mystery bolt");
    expect(t).toContain("no agreed price yet");
    expect(unpriced.total).toBe(100);
    expect(unpriced.unpricedCount).toBe(1);
  });

  it("works without a linked supplier record (name snapshot only) and with no store contact info", () => {
    const { doc: d } = buildPurchaseOrderPdf({ order: order(), store: { name: "Shop" } });
    const t = text(d);
    expect(t).toContain("Acme Cement");
    expect(t).toContain("RWF"); // default currency
  });

  it("falls back gracefully with no supplier at all", () => {
    expect(text(buildPurchaseOrderPdf({ order: order({ supplierName: undefined }), store }).doc)).toContain("Supplier");
  });

  it("refuses to build a PDF for a cancelled order or an empty one", () => {
    expect(() => buildPurchaseOrderPdf({ order: order({ status: "cancelled" }), store })).toThrow(/cancelled/);
    expect(() => buildPurchaseOrderPdf({ order: order({ items: [] }), store })).toThrow(/no items/);
  });

  it("a malformed logo is skipped instead of failing the PDF", () => {
    expect(() => buildPurchaseOrderPdf({ order: order(), store, logoDataUrl: "data:image/png;base64,NOTREAL" })).not.toThrow();
  });

  it("a long order spills onto a second page without losing rows", () => {
    const items = Array.from({ length: 70 }, (_, i) => ({ name: `Item ${i + 1}`, quantityOrdered: 1, unitCost: 10 }));
    const big = buildPurchaseOrderPdf({ order: order({ items }), store, supplier });
    expect(big.doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(text(big.doc)).toContain("Item 70");
    expect(big.total).toBe(700);
  });
});

describe("sharePurchaseOrder (Web Share API)", () => {
  const args = { order: order(), store, supplier };

  it("shares the PDF as a file through the share sheet", async () => {
    const nav = { canShare: vi.fn(() => true), share: vi.fn().mockResolvedValue() };
    const save = vi.fn();
    const result = await sharePurchaseOrder(args, { nav, save });
    expect(result.method).toBe("share");
    const payload = nav.share.mock.calls[0][0];
    expect(payload.files).toHaveLength(1);
    expect(payload.files[0].type).toBe("application/pdf");
    expect(payload.files[0].name).toBe("PO-7890AB-Acme-Cement.pdf");
    expect(payload.files[0].size).toBeGreaterThan(500);
    expect(payload.title).toContain("PO-7890AB");
    expect(save).not.toHaveBeenCalled();
  });

  it("the user closing the share sheet is 'cancelled' — not an error and not a download", async () => {
    const nav = { canShare: () => true, share: vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "AbortError" })) };
    const save = vi.fn();
    expect((await sharePurchaseOrder(args, { nav, save })).method).toBe("cancelled");
    expect(save).not.toHaveBeenCalled();
  });

  it("when the browser can't share files, the PDF is downloaded and the result says so", async () => {
    const save = vi.fn();
    const result = await sharePurchaseOrder(args, { nav: { canShare: () => false }, save });
    expect(result.method).toBe("download");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe("PO-7890AB-Acme-Cement.pdf");
  });

  it("when there is no Web Share API at all, it downloads", async () => {
    const save = vi.fn();
    expect((await sharePurchaseOrder(args, { nav: {}, save })).method).toBe("download");
    expect(save).toHaveBeenCalled();
  });

  it("if the browser refuses the share (e.g. permission window expired), it falls back to a download — never silently nothing", async () => {
    const nav = { canShare: () => true, share: vi.fn().mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" })) };
    const save = vi.fn();
    expect((await sharePurchaseOrder(args, { nav, save })).method).toBe("download");
    expect(save).toHaveBeenCalled();
  });

  it("a cancelled order is never shared", async () => {
    const nav = { canShare: () => true, share: vi.fn() };
    await expect(sharePurchaseOrder({ ...args, order: order({ status: "cancelled" }) }, { nav, save: vi.fn() })).rejects.toThrow(/cancelled/);
    expect(nav.share).not.toHaveBeenCalled();
  });
});

describe("printPurchaseOrder", () => {
  const args = { order: order(), store, supplier };

  it("points the pre-opened tab at the PDF", () => {
    const win = { location: { href: "" }, close: vi.fn() };
    const result = printPurchaseOrder(args, { openWindow: () => win, save: vi.fn() });
    expect(result.method).toBe("print");
    expect(win.location.href).toMatch(/^blob:/);
  });

  it("a blocked pop-up falls back to a download and reports it honestly", () => {
    const save = vi.fn();
    const result = printPurchaseOrder(args, { openWindow: () => null, save });
    expect(result.method).toBe("download");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("if building fails, the blank tab it opened is closed again", () => {
    const win = { location: { href: "" }, close: vi.fn() };
    expect(() => printPurchaseOrder({ ...args, order: order({ status: "cancelled" }) }, { openWindow: () => win, save: vi.fn() })).toThrow();
    expect(win.close).toHaveBeenCalled();
  });
});