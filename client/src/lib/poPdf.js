import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { loadImageAsDataUrl, imageFormatFromDataUrl } from "./pdfReport.js";

/**
 * Purchase-order PDF for sending to a supplier: items, quantities, UNIT COSTS
 * and line totals, so the supplier sees exactly what was agreed and can send
 * back updated prices with the delivery if theirs have changed.
 *
 * Nothing here fabricates data: a line with no agreed unit cost prints "—"
 * (never 0) and is excluded from the total, and the PDF says so.
 */

const FOOTER_NOTE = "If your prices have changed since this order, please send the updated prices with the delivery.";

/** Short, stable reference. Uses clientId (present from creation, identical on every device), not the server id. */
export function poReference(order) {
  const raw = String(order.clientId || order.id || "").replace(/[^a-z0-9]/gi, "");
  return `PO-${raw.slice(-6).toUpperCase() || "000000"}`;
}

const priced = (cost) => Number.isFinite(Number(cost)) && Number(cost) > 0;

/** Lines with their totals, the order total, and how many lines have no agreed price. */
export function computePoTotals(order) {
  let total = 0;
  let unpricedCount = 0;
  let anyReceived = false;
  const lines = (order.items || []).map((item) => {
    const quantity = Number(item.quantityOrdered) || 0;
    const received = Number(item.quantityReceived) || 0;
    if (received > 0) anyReceived = true;
    if (!priced(item.unitCost)) {
      unpricedCount += 1;
      return { name: item.name, quantity, received, unitCost: null, lineTotal: null };
    }
    const unitCost = Number(item.unitCost);
    const lineTotal = Math.round(unitCost * quantity * 100) / 100;
    total += lineTotal;
    return { name: item.name, quantity, received, unitCost, lineTotal };
  });
  return { lines, total: Math.round(total * 100) / 100, unpricedCount, anyReceived };
}

const logoCache = new Map();

/**
 * Fetches (once) and caches a store logo as a data URL. Call this when the
 * page opens — NOT inside a click handler — so Share doesn't have to wait on
 * the network (browsers only allow the share sheet shortly after the tap).
 * Resolves to null if the logo is missing/unreachable; the PDF just omits it.
 */
export async function loadStoreLogo(url) {
  if (!url) return null;
  if (!logoCache.has(url)) logoCache.set(url, await loadImageAsDataUrl(url));
  return logoCache.get(url);
}

function safeFileName(text) {
  return String(text || "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Builds the PDF in memory. Pure and synchronous apart from jsPDF itself — fast enough to run inside a tap. */
export function buildPurchaseOrderPdf({ order, store, supplier, logoDataUrl }) {
  if (order.status === "cancelled") throw new Error("A cancelled order can't be sent to a supplier");
  if (!order.items?.length) throw new Error("This order has no items");

  const currency = store?.currency || "RWF";
  const money = (n) => `${Number(n).toLocaleString()} ${currency}`;
  const reference = poReference(order);
  const { lines, total, unpricedCount, anyReceived } = computePoTotals(order);

  const doc = new jsPDF();
  const marginX = 14;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 20;

  if (logoDataUrl) {
    try {
      const props = doc.getImageProperties(logoDataUrl);
      const width = 22;
      const height = (props.height / props.width) * width;
      doc.addImage(logoDataUrl, imageFormatFromDataUrl(logoDataUrl), marginX, y - 14, width, height);
      y += Math.max(0, height - 14);
    } catch {
      // Malformed logo data — skip it rather than fail the whole PDF.
    }
  }

  doc.setFontSize(18);
  doc.setTextColor(20, 24, 32);
  doc.text(store?.name || "Store", marginX, y);
  doc.setFontSize(10);
  doc.setTextColor(110, 120, 135);
  let storeY = y + 6;
  for (const line of [store?.address, store?.phone].filter(Boolean)) {
    doc.text(line, marginX, storeY);
    storeY += 5;
  }

  doc.setFontSize(16);
  doc.setTextColor(20, 24, 32);
  doc.text("PURCHASE ORDER", pageWidth - marginX, y, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(110, 120, 135);
  doc.text(reference, pageWidth - marginX, y + 6, { align: "right" });
  doc.text(`Date: ${order.createdAt ? new Date(order.createdAt).toLocaleDateString() : new Date().toLocaleDateString()}`, pageWidth - marginX, y + 11, { align: "right" });
  if (order.expectedDate) doc.text(`Expected: ${new Date(order.expectedDate).toLocaleDateString()}`, pageWidth - marginX, y + 16, { align: "right" });

  y = Math.max(storeY, y + 22) + 4;

  doc.setFontSize(10);
  doc.setTextColor(110, 120, 135);
  doc.text("TO", marginX, y);
  doc.setFontSize(12);
  doc.setTextColor(20, 24, 32);
  doc.text(order.supplierName || supplier?.name || "Supplier", marginX, y + 6);
  doc.setFontSize(10);
  doc.setTextColor(110, 120, 135);
  let toY = y + 11;
  for (const line of [supplier?.phone, supplier?.email, supplier?.address].filter(Boolean)) {
    doc.text(line, marginX, toY);
    toY += 5;
  }
  y = toY + 4;

  const head = anyReceived ? [["#", "Item", "Qty", "Received", "Unit cost", "Line total"]] : [["#", "Item", "Qty", "Unit cost", "Line total"]];
  const body = lines.map((l, i) => {
    const cells = [i + 1, l.name, l.quantity.toLocaleString()];
    if (anyReceived) cells.push(l.received.toLocaleString());
    cells.push(l.unitCost === null ? "—" : money(l.unitCost), l.lineTotal === null ? "—" : money(l.lineTotal));
    return cells;
  });
  const lastCols = 2; // unit cost + line total are always the last two columns
  const colCount = head[0].length;

  autoTable(doc, {
    startY: y,
    head,
    body,
    foot: [[{ content: "Total", colSpan: colCount - 1, styles: { halign: "right" } }, money(total)]],
    headStyles: { fillColor: [16, 20, 27], textColor: 255 },
    footStyles: { fillColor: [240, 242, 246], textColor: [20, 24, 32], fontStyle: "bold" },
    columnStyles: Object.fromEntries(Array.from({ length: lastCols }, (_, k) => [colCount - 1 - k, { halign: "right" }])),
    margin: { left: marginX, right: marginX },
  });
  y = doc.lastAutoTable.finalY + 8;

  const pageHeight = doc.internal.pageSize.getHeight();
  const write = (text, color = [110, 120, 135]) => {
    doc.setFontSize(10);
    doc.setTextColor(...color);
    const wrapped = doc.splitTextToSize(text, pageWidth - marginX * 2);
    if (y + wrapped.length * 5 > pageHeight - 14) {
      doc.addPage();
      y = 20;
    }
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 5 + 3;
  };

  if (unpricedCount > 0) {
    write(`${unpricedCount} item${unpricedCount === 1 ? "" : "s"} marked "—" ${unpricedCount === 1 ? "has" : "have"} no agreed price yet and ${unpricedCount === 1 ? "is" : "are"} not included in the total.`, [180, 90, 20]);
  }
  if (order.notes) write(`Notes: ${order.notes}`, [20, 24, 32]);
  write(FOOTER_NOTE);

  const blob = doc.output("blob");
  const filename = `${reference}${order.supplierName ? `-${safeFileName(order.supplierName)}` : ""}.pdf`;
  return { doc, blob, filename, reference, total, unpricedCount };
}

/**
 * Opens the PDF in a new tab with the print dialog. The tab must be opened
 * synchronously inside the click, then pointed at the PDF once built.
 * If the browser blocks the pop-up, the PDF is downloaded instead and the
 * result says so — it never reports "printed" when nothing was shown.
 * Returns { method: "print" | "download" }.
 */
export function printPurchaseOrder(args, { openWindow = () => window.open("", "_blank"), save = (doc, name) => doc.save(name) } = {}) {
  const win = openWindow();
  let built;
  try {
    built = buildPurchaseOrderPdf(args);
  } catch (err) {
    win?.close();
    throw err;
  }
  if (!win) {
    save(built.doc, built.filename);
    return { method: "download", filename: built.filename };
  }
  built.doc.autoPrint();
  const url = URL.createObjectURL(built.doc.output("blob"));
  win.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { method: "print", filename: built.filename };
}

/**
 * Shares the PDF through the device's share sheet (WhatsApp, email, …) via
 * the Web Share API. Where file sharing isn't supported — or the browser
 * refuses it — the PDF is downloaded so it can be attached by hand, and the
 * result says so. Returns { method: "share" | "cancelled" | "download" }.
 */
export async function sharePurchaseOrder(
  args,
  { nav = typeof navigator === "undefined" ? undefined : navigator, save = (doc, name) => doc.save(name) } = {}
) {
  const built = buildPurchaseOrderPdf(args);
  const store = args.store?.name || "our store";
  const file = new File([built.blob], built.filename, { type: "application/pdf" });

  if (nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: `Purchase order ${built.reference}`, text: `Purchase order ${built.reference} from ${store}` });
      return { method: "share", filename: built.filename };
    } catch (err) {
      if (err?.name === "AbortError") return { method: "cancelled", filename: built.filename }; // user closed the sheet — not an error
      // The browser refused (e.g. the tap's permission window had passed): fall through to a download.
    }
  }
  save(built.doc, built.filename);
  return { method: "download", filename: built.filename };
}