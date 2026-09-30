import { useEffect, useRef, useState } from "react";
import { MoreVertical, Check } from "lucide-react";
import styles from "./PeriodMenu.module.css";

const OPTIONS = [
  { value: "today", label: "Today" },
  { value: "month", label: "This Month" },
  { value: "year", label: "This Year" },
];

export default function PeriodMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div className={styles.wrap} ref={ref}>
      <button
        className={styles.trigger}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Filter by period"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
          <div className={styles.menuLabel}>Filter</div>
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={styles.item}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              <span className={styles.checkSlot}>{opt.value === value && <Check size={13} />}</span>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
