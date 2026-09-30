import { ChevronLeft, ChevronRight } from "lucide-react";
import PeriodMenu from "../PeriodMenu/PeriodMenu.jsx";
import styles from "./PeriodNav.module.css";

export default function PeriodNav({ rangeLabel, period, onPeriodChange, onBack, onForward, canGoForward }) {
  return (
    <div className={styles.wrap}>
      <button className={styles.arrow} onClick={onBack} title="Look at the previous period">
        <ChevronLeft size={14} />
      </button>
      <span className={styles.label}>{rangeLabel}</span>
      <button className={styles.arrow} onClick={onForward} disabled={!canGoForward} title="Look at the next period">
        <ChevronRight size={14} />
      </button>
      <PeriodMenu value={period} onChange={onPeriodChange} />
    </div>
  );
}
