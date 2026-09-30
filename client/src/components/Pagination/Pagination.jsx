import { ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./Pagination.module.css";

export default function Pagination({ page, pageCount, onChange, totalItems, pageSize }) {
  if (pageCount <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  return (
    <div className={styles.wrap}>
      <span className={styles.rangeText}>
        {start}–{end} of {totalItems}
      </span>
      <div className={styles.controls}>
        <button className={styles.btn} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={15} />
        </button>
        <span className={styles.pageText}>
          Page {page} of {pageCount}
        </span>
        <button className={styles.btn} disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
