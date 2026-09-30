import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

async function loadImageAsDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null; // offline, CORS, or a bad URL — the report still generates fine without a logo
  }
}

function imageFormatFromDataUrl(dataUrl) {
  const match = /^data:image\/(\w+);base64,/.exec(dataUrl);
  if (!match) return "PNG";
  const type = match[1].toUpperCase();
  return type === "JPG" ? "JPEG" : type;
}

/** Adds a page break before a section if it wouldn't fit on what's left of the current page. */
function ensureSpace(doc, y, needed = 24) {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - 14) {
    doc.addPage();
    return 20;
  }
  return y;
}

function sectionHeader(doc, marginX, y, title) {
  doc.setFontSize(13);
  doc.setTextColor(20, 24, 32);
  doc.text(title, marginX, y);
  return y + 6;
}

function emptyNote(doc, marginX, y, text) {
  doc.setFontSize(10);
  doc.setTextColor(110, 120, 135);
  doc.text(text, marginX, y);
  doc.setTextColor(20, 24, 32);
  return y + 14;
}

/**
 * Builds and downloads a PDF summary for the currently selected period.
 * Runs entirely in the browser (no server round trip for the document
 * itself — only the optional logo and staff-performance data need a
 * connection, and both degrade gracefully without one).
 *
 * All sections beyond stats/topProducts/lowStock are optional — pass what
 * you have. Missing sections are simply skipped, not shown as empty.
 */
export async function generateReportPdf({
  storeName,
  storeLogoUrl,
  periodLabel,
  currency,
  stats,
  topProducts,
  lowStock,
  lowStockThresholdDefault,
  paymentBreakdown, // [{ method, count, revenue }]
  categoryBreakdown, // [{ category, revenue }]
  dailySeries, // [{ label, sales, revenue, items }]
  staffPerformance, // [{ name, role, salesCount, itemsSold, revenue }] | null if unavailable
  creditSummary, // [{ customerName, balance }] | null if unavailable
}) {
  const doc = new jsPDF();
  const marginX = 14;
  let headerY = 20;

  if (storeLogoUrl) {
    const dataUrl = await loadImageAsDataUrl(storeLogoUrl);
    if (dataUrl) {
      try {
        const props = doc.getImageProperties(dataUrl);
        const width = 22;
        const height = (props.height / props.width) * width;
        doc.addImage(dataUrl, imageFormatFromDataUrl(dataUrl), marginX, headerY - 14, width, height);
        headerY += Math.max(0, height - 14);
      } catch {
        // Malformed image data — skip it rather than fail the whole report.
      }
    }
  }

  doc.setFontSize(18);
  doc.setTextColor(20, 24, 32);
  doc.text(storeName, marginX, headerY);
  doc.setFontSize(11);
  doc.setTextColor(110, 120, 135);
  doc.text(`Sales report — ${periodLabel}`, marginX, headerY + 8);
  doc.text(`Generated ${new Date().toLocaleString()}`, marginX, headerY + 14);
  doc.setTextColor(20, 24, 32);

  autoTable(doc, {
    startY: headerY + 22,
    head: [["Metric", "Value"]],
    body: [
      ["Sales", stats.sales.toLocaleString()],
      ["Revenue", `${stats.revenue.toLocaleString()} ${currency}`],
      ["Items sold", stats.items.toLocaleString()],
    ],
    theme: "plain",
    headStyles: { fillColor: [16, 20, 27], textColor: 255 },
    margin: { left: marginX, right: marginX },
  });

  let y = doc.lastAutoTable.finalY + 12;

  // --- Top products ---
  y = ensureSpace(doc, y, 30);
  y = sectionHeader(doc, marginX, y, "Top products");
  if (!topProducts?.length) {
    y = emptyNote(doc, marginX, y + 6, "No sales recorded for this period.");
  } else {
    autoTable(doc, {
      startY: y + 2,
      head: [["#", "Product", "Sold", "Revenue"]],
      body: topProducts.slice(0, 25).map((p, i) => [i + 1, p.name, p.quantity, `${p.revenue.toLocaleString()} ${currency}`]),
      headStyles: { fillColor: [16, 20, 27], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // --- Payment method breakdown ---
  if (paymentBreakdown?.length) {
    y = ensureSpace(doc, y, 30);
    y = sectionHeader(doc, marginX, y, "By payment method");
    autoTable(doc, {
      startY: y + 2,
      head: [["Method", "Sales", "Revenue"]],
      body: paymentBreakdown.map((p) => [p.method, p.count, `${p.revenue.toLocaleString()} ${currency}`]),
      headStyles: { fillColor: [16, 20, 27], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // --- Category breakdown ---
  if (categoryBreakdown?.length) {
    y = ensureSpace(doc, y, 30);
    y = sectionHeader(doc, marginX, y, "By category");
    autoTable(doc, {
      startY: y + 2,
      head: [["Category", "Revenue"]],
      body: categoryBreakdown.map((c) => [c.category || "Uncategorized", `${c.revenue.toLocaleString()} ${currency}`]),
      headStyles: { fillColor: [16, 20, 27], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // --- Day-by-day ---
  if (dailySeries?.length) {
    y = ensureSpace(doc, y, 30);
    y = sectionHeader(doc, marginX, y, "Day by day");
    autoTable(doc, {
      startY: y + 2,
      head: [["", "Sales", "Revenue", "Items sold"]],
      body: dailySeries.map((d) => [d.label, d.sales, `${d.revenue.toLocaleString()} ${currency}`, d.items]),
      headStyles: { fillColor: [16, 20, 27], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // --- Staff performance ---
  if (staffPerformance?.length) {
    y = ensureSpace(doc, y, 30);
    y = sectionHeader(doc, marginX, y, "Staff performance");
    autoTable(doc, {
      startY: y + 2,
      head: [["Team member", "Role", "Sales", "Items sold", "Revenue"]],
      body: staffPerformance.map((s) => [s.name, s.role || "", s.salesCount, s.itemsSold, `${s.revenue.toLocaleString()} ${currency}`]),
      headStyles: { fillColor: [16, 20, 27], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // --- Credit summary ---
  if (creditSummary?.length) {
    y = ensureSpace(doc, y, 30);
    y = sectionHeader(doc, marginX, y, "Outstanding credit balances");
    autoTable(doc, {
      startY: y + 2,
      head: [["Customer", "Balance owed"]],
      body: creditSummary.map((c) => [c.customerName, `${c.balance.toLocaleString()} ${currency}`]),
      headStyles: { fillColor: [201, 79, 79], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
    y = doc.lastAutoTable.finalY + 12;
  }

  // --- Low stock ---
  y = ensureSpace(doc, y, 30);
  y = sectionHeader(doc, marginX, y, "Low stock right now");
  if (!lowStock?.length) {
    emptyNote(doc, marginX, y + 6, "Nothing is running low.");
  } else {
    autoTable(doc, {
      startY: y + 2,
      head: [["Product", "On hand", "Alert threshold"]],
      body: lowStock.map((p) => [p.name, p.quantityOnHand, p.lowStockThreshold ?? lowStockThresholdDefault ?? 5]),
      headStyles: { fillColor: [201, 79, 79], textColor: 255 },
      margin: { left: marginX, right: marginX },
    });
  }

  const safeStore = storeName.replace(/[^a-z0-9]+/gi, "-");
  const safePeriod = periodLabel.replace(/[^a-z0-9]+/gi, "-");
  doc.save(`${safeStore}-report-${safePeriod}.pdf`);
}
