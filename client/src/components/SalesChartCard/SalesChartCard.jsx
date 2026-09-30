import { useEffect, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Card } from "../ui/ui.jsx";
import PeriodNav from "../PeriodNav/PeriodNav.jsx";
import { usePeriodNavigator } from "../../hooks/usePeriodNavigator.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { getSalesSeries } from "../../lib/repo.js";
import { formatCompactNumber } from "../../lib/format.js";
import styles from "./SalesChartCard.module.css";

function CustomTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{point?.date ? new Date(point.date).toLocaleString() : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color }} />
          <span className={styles.tooltipLabel}>{p.name}:</span>
          <span className={styles.tooltipValue}>
            {p.dataKey === "revenue" ? `${p.value.toLocaleString()} ${currency}` : p.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * `navigator` is optional: pass one down (from usePeriodNavigator at a
 * parent level) to share it with sibling content — e.g. the Reports page
 * uses this so "Top products" and "Activity trail" follow the same period
 * the chart is showing. Omit it and the chart manages its own, independent
 * period (e.g. on the Dashboard, where each card is independent).
 */
export default function SalesChartCard({ currency = "RWF", initialPeriod = "today", navigator: externalNav, title = "Reports" }) {
  const internalNav = usePeriodNavigator(initialPeriod);
  const nav = externalNav || internalNav;
  const [data, setData] = useState([]);
  const isMobile = useIsMobile();

  // On a phone, "This Month" can be 28-31 x-axis labels crammed into
  // ~340px of usable width — that's the actual source of the clutter,
  // not the chart's pixel size. Thinning to ~6 evenly-spaced labels on
  // mobile fixes that without touching desktop, which keeps every label
  // (interval=0, identical to today's behavior).
  const xAxisInterval = isMobile ? Math.max(0, Math.ceil(data.length / 6) - 1) : 0;

  async function load() {
    setData(await getSalesSeries(nav.period, nav.offset));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.period, nav.offset]);

  return (
    <Card className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{title}</span>
        <PeriodNav
          rangeLabel={nav.rangeLabel}
          period={nav.period}
          onPeriodChange={nav.setPeriod}
          onBack={nav.goBack}
          onForward={nav.goForward}
          canGoForward={nav.canGoForward}
        />
      </div>

      {data.every((d) => d.sales === 0 && d.revenue === 0 && d.items === 0) ? (
        <p className={styles.empty}>No sales recorded for this period.</p>
      ) : (
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e6ec" vertical={false} />
              <XAxis dataKey="label" interval={xAxisInterval} tick={{ fontSize: 11, fill: "#5c6b7e" }} axisLine={false} tickLine={false} />
              {/* Sales/Items sold are small counts (e.g. 1-50) while Revenue
                  is currency in the thousands — sharing one axis makes the
                  count lines look permanently flat next to Revenue. Two
                  axes keep both scales readable on the same chart. */}
              <YAxis yAxisId="counts" tick={{ fontSize: 11, fill: "#5c6b7e" }} axisLine={false} tickLine={false} width={32} />
              <YAxis
                yAxisId="revenue"
                orientation="right"
                tick={{ fontSize: 11, fill: "#5c6b7e" }}
                axisLine={false}
                tickLine={false}
                width={isMobile ? 34 : 44}
                tickFormatter={isMobile ? formatCompactNumber : undefined}
              />
              <Tooltip content={<CustomTooltip currency={currency} />} />
              <Line yAxisId="counts" type="monotone" dataKey="sales" name="Sales" stroke="#3c7fc9" strokeWidth={2} dot={isMobile ? false : { r: 3 }} activeDot={{ r: 5 }} />
              <Line yAxisId="revenue" type="monotone" dataKey="revenue" name="Revenue" stroke="#2f9463" strokeWidth={2} dot={isMobile ? false : { r: 3 }} activeDot={{ r: 5 }} />
              <Line yAxisId="counts" type="monotone" dataKey="items" name="Items sold" stroke="#d98e2b" strokeWidth={2} dot={isMobile ? false : { r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
          <div className={styles.legend}>
            <span><i style={{ background: "#3c7fc9" }} /> Sales</span>
            <span><i style={{ background: "#2f9463" }} /> Revenue</span>
            <span><i style={{ background: "#d98e2b" }} /> Items sold</span>
          </div>
        </div>
      )}
    </Card>
  );
}