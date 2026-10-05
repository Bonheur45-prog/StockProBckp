import { useEffect, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Activity, WifiOff, FileDown } from "lucide-react";
import { Card, Badge, Button, Input } from "../../components/ui/ui.jsx";
import Pagination from "../../components/Pagination/Pagination.jsx";
import SalesChartCard from "../../components/SalesChartCard/SalesChartCard.jsx";
import { getTopProducts, listSales, listProducts, getStatForPeriod, getSalesSeries, listCustomerBalances, effectiveLowStockThreshold } from "../../lib/repo.js";
import { usePagination } from "../../hooks/usePagination.js";
import { usePeriodNavigator } from "../../hooks/usePeriodNavigator.js";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Reports.module.css";

const ACTIVITY_PAGE_SIZE = 8;

function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push(d);
  }
  return days;
}

export default function Reports() {
  const { store } = useAuth();
  const nav = usePeriodNavigator("month");

  // Custom date range — Reports-only, layered on top of the existing
  // Today/This Month/This Year navigator rather than replacing it. When
  // set, it wins over nav.period/nav.offset for Top Products, the
  // Activity trail, and PDF export; the bucketed chart above keeps using
  // the preset navigator regardless (see getSalesSeries — its hourly/
  // daily/monthly bucketing doesn't have a sensible answer for an
  // arbitrary range without its own, separate bucket-sizing logic).
  const [customRange, setCustomRange] = useState(null);
  const [rangeDraft, setRangeDraft] = useState({ start: "", end: "" });

  function applyCustomRange() {
    if (!rangeDraft.start || !rangeDraft.end) return;
    const start = new Date(rangeDraft.start);
    const end = new Date(rangeDraft.end);
    end.setDate(end.getDate() + 1); // end date inclusive of its whole day
    if (start >= end) return;
    setCustomRange({ start, end });
  }

  function clearCustomRange() {
    setCustomRange(null);
    setRangeDraft({ start: "", end: "" });
  }

  const effectiveRangeLabel = customRange
    ? `${customRange.start.toLocaleDateString()} – ${new Date(customRange.end.getTime() - 86400000).toLocaleDateString()}`
    : nav.rangeLabel;

  const [topProducts, setTopProducts] = useState([]);
  const [last14DaysData, setLast14DaysData] = useState([]);
  const [exporting, setExporting] = useState(false);

  const [activity, setActivity] = useState(null);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityPage, setActivityPage] = useState(1);
  const [activityError, setActivityError] = useState(false);

  const topProductsPage = usePagination(topProducts, 8);

  async function loadLast14Days() {
    const sales = await listSales();
    const completed = sales.filter((s) => s.status === "completed");
    const days = lastNDays(14);
    const byDay = days.map((d) => {
      const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const dayTotal = completed
        .filter((s) => {
          const t = new Date(s.occurredAt);
          return t >= d && t < new Date(d.getTime() + 86400000);
        })
        .reduce((sum, s) => sum + s.total, 0);
      return { day: label, total: dayTotal };
    });
    setLast14DaysData(byDay);
  }

  // Top products follows the same period the chart is showing (time-travel included).
  useEffect(() => {
    getTopProducts(nav.period, nav.offset, false, customRange).then(setTopProducts);
    topProductsPage.setPage(1);
    const interval = setInterval(() => getTopProducts(nav.period, nav.offset, false, customRange).then(setTopProducts), 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.period, nav.offset, customRange]);

  useEffect(() => {
    loadLast14Days();
    const interval = setInterval(loadLast14Days, 5000);
    return () => clearInterval(interval);
  }, []);

  // Activity trail follows the same period too — or the custom range, when active.
  useEffect(() => {
    setActivityPage(1);
  }, [nav.period, nav.offset, customRange]);

  useEffect(() => {
    if (!navigator.onLine) {
      setActivityError(true);
      return;
    }
    setActivityError(false);
    const range = customRange || nav.range;
    api
      .get("/reports/activity", {
        params: {
          page: activityPage,
          limit: ACTIVITY_PAGE_SIZE,
          from: range.start.toISOString(),
          to: range.end.toISOString(),
        },
      })
      .then(({ data }) => {
        setActivity(data.items);
        setActivityTotal(data.total);
      })
      .catch(() => setActivityError(true));
  }, [activityPage, nav.range, customRange]);

  const currency = store?.currency || "RWF";
  const activityPageCount = Math.max(1, Math.ceil(activityTotal / ACTIVITY_PAGE_SIZE));

  async function handleExportPdf() {
    setExporting(true);
    try {
      const [{ generateReportPdf }, sales, items, revenue, products, allSales, balances] = await Promise.all([
        import("../../lib/pdfReport.js"),
        getStatForPeriod("sales", nav.period, nav.offset, customRange),
        getStatForPeriod("items", nav.period, nav.offset, customRange),
        getStatForPeriod("revenue", nav.period, nav.offset, customRange),
        listProducts(),
        listSales(),
        listCustomerBalances(),
      ]);
      const lowStock = products.filter((p) => p.quantityOnHand <= effectiveLowStockThreshold(p, store));

      const exportRange = customRange || nav.range;
      const inRange = allSales.filter((s) => {
        if (s.status !== "completed") return false;
        const t = new Date(s.occurredAt);
        return t >= exportRange.start && t < exportRange.end;
      });

      // Payment method breakdown
      const paymentMap = new Map();
      for (const s of inRange) {
        const prev = paymentMap.get(s.paymentMethod) || { method: s.paymentMethod.replace("_", " "), count: 0, revenue: 0 };
        prev.count += 1;
        prev.revenue += s.total;
        paymentMap.set(s.paymentMethod, prev);
      }
      const paymentBreakdown = [...paymentMap.values()].sort((a, b) => b.revenue - a.revenue);

      // Category breakdown — cross-reference each sale line against the
      // current product catalog, since sale items only snapshot name/price,
      // not category.
      const productByRef = new Map();
      for (const p of products) {
        productByRef.set(p.clientId, p);
        if (p.id) productByRef.set(p.id, p);
      }
      const categoryMap = new Map();
      for (const s of inRange) {
        for (const item of s.items || []) {
          const product = item.productId ? productByRef.get(item.productId) : null;
          const category = product?.category || "Uncategorized";
          const prev = categoryMap.get(category) || { category, revenue: 0 };
          prev.revenue += item.lineTotal;
          categoryMap.set(category, prev);
        }
      }
      const categoryBreakdown = [...categoryMap.values()].sort((a, b) => b.revenue - a.revenue);

      const dailySeries = await getSalesSeries(nav.period, nav.offset);

      // Staff performance needs a connection and owner/manager permission —
      // omit the section entirely rather than fail the whole export if
      // either isn't available (e.g. a cashier exporting, or offline).
      let staffPerformance = null;
      if (navigator.onLine) {
        try {
          const { data } = await api.get("/reports/staff-performance", {
            params: { from: exportRange.start.toISOString(), to: exportRange.end.toISOString() },
          });
          staffPerformance = data;
        } catch {
          staffPerformance = null;
        }
      }

      const creditSummary = balances
        .filter((b) => b.balance > 0)
        .slice(0, 15)
        .map((b) => ({ customerName: b.customerName, balance: b.balance }));

      await generateReportPdf({
        storeName: store?.name || "Store",
        storeLogoUrl: store?.logoUrl,
        periodLabel: effectiveRangeLabel,
        currency,
        stats: { sales: sales.value, revenue: revenue.value, items: items.value },
        topProducts,
        lowStock,
        lowStockThresholdDefault: store?.lowStockThresholdDefault,
        paymentBreakdown,
        categoryBreakdown,
        dailySeries,
        staffPerformance,
        creditSummary,
      });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Reports</h1>
          <p className={styles.sub}>Sales trends, top sellers, and a full activity trail.</p>
        </div>
        <Button variant="ghost" onClick={handleExportPdf} disabled={exporting}>
          <FileDown size={16} /> {exporting ? "Preparing…" : "Export PDF"}
        </Button>
      </div>

      <div className={styles.customRangeBar}>
        <Input type="date" value={rangeDraft.start} onChange={(e) => setRangeDraft((d) => ({ ...d, start: e.target.value }))} />
        <span className={styles.muted}>to</span>
        <Input type="date" value={rangeDraft.end} onChange={(e) => setRangeDraft((d) => ({ ...d, end: e.target.value }))} />
        <Button variant="ghost" onClick={applyCustomRange}>Apply range</Button>
        {customRange && <Button variant="ghost" onClick={clearCustomRange}>Clear</Button>}
        {customRange && <span className={styles.muted}>Applies to Top products, Activity trail, and PDF export — not the chart below.</span>}
      </div>

      <div className={styles.chartRow}>
        <SalesChartCard currency={currency} navigator={nav} />
      </div>

      <Card className={styles.chartRow}>
        <h3 className={styles.cardTitle}>Sales, last 14 days</h3>
        <div className={styles.barChartWrap}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={last14DaysData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ec" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#5c6b7e" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#5c6b7e" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                formatter={(v) => [`${v.toLocaleString()} ${currency}`, "Sales"]}
                contentStyle={{ borderRadius: 8, border: "1px solid #e2e6ec", fontSize: 13 }}
              />
              <Bar dataKey="total" fill="#d98e2b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className={styles.twoCol}>
        <Card>
          <h3 className={styles.cardTitle}>Top products <span className={styles.periodHint}>— {effectiveRangeLabel}</span></h3>
          {topProducts.length === 0 ? (
            <p className={styles.muted}>No sales recorded for this period.</p>
          ) : (
            <>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Product</th>
                      <th data-align="right">Sold</th>
                      <th data-align="right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topProductsPage.pageItems.map((p, i) => (
                      <tr key={p.name}>
                        <td className="data-table-mono">{(topProductsPage.page - 1) * topProductsPage.pageSize + i + 1}</td>
                        <td>{p.name}</td>
                        <td data-align="right" className="data-table-mono">{p.quantity}</td>
                        <td data-align="right" className="data-table-mono">{p.revenue.toLocaleString()} {currency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={topProductsPage.page}
                pageCount={topProductsPage.pageCount}
                onChange={topProductsPage.setPage}
                totalItems={topProductsPage.totalItems}
                pageSize={topProductsPage.pageSize}
              />
            </>
          )}
        </Card>

        <Card>
          <div className={styles.cardHeader}>
            <Activity size={16} />
            <h3>Activity trail <span className={styles.periodHint}>— {effectiveRangeLabel}</span></h3>
          </div>
          {activityError ? (
            <p className={styles.muted}><WifiOff size={14} style={{ verticalAlign: -2, marginRight: 5 }} />Connect to the internet to view the activity trail.</p>
          ) : !activity ? (
            <p className={styles.muted}>Loading…</p>
          ) : activity.length === 0 ? (
            <p className={styles.muted}>No activity recorded for this period.</p>
          ) : (
            <>
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>By</th>
                      <th>Entity</th>
                      <th data-align="right">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((a) => (
                      <tr key={a._id}>
                        <td><Badge tone="neutral">{a.action}</Badge></td>
                        <td>{a.userId?.name || "Someone"}</td>
                        <td>{a.entityType}</td>
                        <td data-align="right" className="data-table-mono">{new Date(a.createdAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={activityPage}
                pageCount={activityPageCount}
                onChange={setActivityPage}
                totalItems={activityTotal}
                pageSize={ACTIVITY_PAGE_SIZE}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}