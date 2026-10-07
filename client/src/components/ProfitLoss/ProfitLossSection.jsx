import { useEffect, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Card } from "../ui/ui.jsx";
import { getProfitAndLoss, getIncomeExpenseSeries } from "../../lib/repo.js";
import { describeAccuracy } from "../../lib/profitLoss.js";
import { formatCompactNumber } from "../../lib/format.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import styles from "./ProfitLoss.module.css";

const INCOME_COLOR = "#34d399";
const EXPENSE_COLOR = "#3b82f6";

function ChartTooltip({ active, payload, currency }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipDate}>{point.fullLabel}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className={styles.tooltipRow}>
          <span className={styles.tooltipDot} style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className={styles.tooltipValue}>{Number(p.value).toLocaleString()} {currency}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Revenue − Cost of goods − Expenses = Net profit for the period Reports is
 * showing (including its custom range), with plain-language labels on every
 * number that rests on an estimate. Owner/manager only — Reports gates it,
 * and the data layer refuses cashiers independently.
 */
export default function ProfitLossSection({ currency = "RWF", period, offset, customRange, rangeLabel }) {
  const [pl, setPl] = useState(null);
  const [series, setSeries] = useState([]);
  const [error, setError] = useState("");
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [data, points] = await Promise.all([
          getProfitAndLoss(period, offset, customRange),
          getIncomeExpenseSeries(period, offset, customRange),
        ]);
        if (!cancelled) {
          setPl(data);
          setSeries(points);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Couldn't load profit & loss");
      }
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [period, offset, customRange]);

  if (error) {
    return <Card className={styles.card}><p className={styles.range}>{error}</p></Card>;
  }
  if (!pl) return null;

  const money = (n) => `${Number(n).toLocaleString()} ${currency}`;
  const notes = describeAccuracy(pl, currency);
  const { snapshot, history, estimate } = pl.cogsBySource;
  const allExact = notes.length === 0 && pl.cogs > 0;
  const tone = pl.netProfit >= 0 ? "profit" : "loss";
  const hasChartData = series.some((b) => b.income > 0 || b.expenses > 0);
  const xInterval = isMobile ? Math.max(0, Math.ceil(series.length / 6) - 1) : series.length > 16 ? Math.ceil(series.length / 12) - 1 : 0;

  return (
    <Card className={styles.card}>
      <div className={styles.head}>
        <h3 className={styles.title}>Profit &amp; Loss</h3>
        <span className={styles.range}>{rangeLabel}</span>
      </div>

      <div className={styles.equation}>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>Revenue</div>
          <div className={styles.cellValue}>{money(pl.revenue)}</div>
          <div className={styles.cellSub}>{pl.salesCount} sale{pl.salesCount === 1 ? "" : "s"}, after discounts</div>
        </div>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>− Cost of goods</div>
          <div className={styles.cellValue}>{money(pl.cogs)}</div>
          <div className={styles.cellSub}>
            Gross profit {money(pl.grossProfit)}{pl.grossMarginPct !== null && ` (${pl.grossMarginPct}%)`}
          </div>
        </div>
        <div className={styles.cell}>
          <div className={styles.cellLabel}>− Expenses</div>
          <div className={styles.cellValue}>{money(pl.expenses)}</div>
          <div className={styles.cellSub}>{pl.expenseCount} expense{pl.expenseCount === 1 ? "" : "s"}</div>
        </div>
        <div className={`${styles.cell} ${styles.net}`} data-tone={tone}>
          <div className={styles.cellLabel}>= Net profit</div>
          <div className={styles.cellValue}>{money(pl.netProfit)}</div>
          <div className={styles.cellSub}>{pl.netMarginPct !== null ? `${pl.netMarginPct}% of revenue` : "No revenue in this period"}</div>
        </div>
      </div>

      {pl.cogs > 0 && (
        <p className={styles.source}>
          Cost of goods: {money(snapshot.amount)} recorded at the time of sale
          {history.amount > 0 && ` · ${money(history.amount)} from price history`}
          {estimate.amount > 0 && ` · ${money(estimate.amount)} estimated from current cost prices`}.
        </p>
      )}
      {allExact && <p className={styles.exact}>Every cost in this period was recorded at the moment of sale — no estimates.</p>}
      {notes.length > 0 && (
        <ul className={styles.notes}>
          {notes.map((n, i) => <li key={i} className={styles.note} data-tone={n.tone}>{n.text}</li>)}
        </ul>
      )}

      <div className={styles.chartPanel}>
        <div className={styles.legend}>
          <span><i style={{ background: INCOME_COLOR }} /> Income</span>
          <span><i style={{ background: EXPENSE_COLOR }} /> Expenses</span>
        </div>
        {hasChartData ? (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="plIncome" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={INCOME_COLOR} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={INCOME_COLOR} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="plExpenses" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={EXPENSE_COLOR} stopOpacity={0.45} />
                  <stop offset="100%" stopColor={EXPENSE_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ffffff" strokeOpacity={0.07} vertical={false} />
              <XAxis dataKey="label" interval={xInterval} tick={{ fontSize: 11, fill: "#8da0b8" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#8da0b8" }} axisLine={false} tickLine={false} width={isMobile ? 36 : 46} tickFormatter={formatCompactNumber} />
              <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: "#8da0b8", strokeDasharray: "3 3" }} />
              <Area type="monotone" dataKey="income" name="Income" stroke={INCOME_COLOR} strokeWidth={2} fill="url(#plIncome)" activeDot={{ r: 4 }} />
              <Area type="monotone" dataKey="expenses" name="Expenses" stroke={EXPENSE_COLOR} strokeWidth={2} fill="url(#plExpenses)" activeDot={{ r: 4 }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <p className={styles.chartEmpty}>No income or expenses recorded for this period.</p>
        )}
      </div>

      {pl.expensesByCategory.length > 0 && (
        <div className={styles.cats}>
          <div className={styles.catsTitle}>Expenses by category</div>
          {pl.expensesByCategory.map((c) => (
            <div key={c.category} className={styles.catRow}>
              <span>{c.category} · {c.count}</span>
              <strong>{money(c.total)}</strong>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}