import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "../ui/ui.jsx";
import PeriodNav from "../PeriodNav/PeriodNav.jsx";
import { usePeriodNavigator } from "../../hooks/usePeriodNavigator.js";
import { getStatForPeriod } from "../../lib/repo.js";
import styles from "./StatCard.module.css";

export default function StatCard({ title, metric, icon: Icon, tone, format, initialPeriod = "today" }) {
  const nav = usePeriodNavigator(initialPeriod);
  const [stat, setStat] = useState({ value: 0, change: 0 });

  async function load() {
    setStat(await getStatForPeriod(metric, nav.period, nav.offset));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.period, nav.offset]);

  const ChangeIcon = stat.change === null || stat.change === 0 ? Minus : stat.change > 0 ? TrendingUp : TrendingDown;
  const changeTone = stat.change === null ? "neutral" : stat.change > 0 ? "up" : stat.change < 0 ? "down" : "neutral";
  const changeText = stat.change === null ? "new" : `${Math.abs(stat.change)}%`;

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
      <div className={styles.body}>
        <div className={styles.iconWrap} data-tone={tone}>
          <Icon size={18} />
        </div>
        <div>
          <div className={styles.value}>{format ? format(stat.value) : stat.value.toLocaleString()}</div>
          <div className={styles.change} data-tone={changeTone}>
            <ChangeIcon size={12} />
            {changeText} {stat.change !== null && (stat.change >= 0 ? "increase" : "decrease")}
          </div>
        </div>
      </div>
    </Card>
  );
}
