import { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import styles from "./KebabMenu.module.css";

/**
 * actions: [{ label, icon: LucideIcon, onClick, tone?: "default"|"danger", disabled?, disabledReason? }]
 */
export default function KebabMenu({ actions }) {
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
        title="Actions"
      >
        <MoreHorizontal size={17} />
      </button>
      {open && (
        <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
          {actions.map((a, i) => (
            <button
              key={i}
              className={styles.item}
              data-tone={a.tone || "default"}
              disabled={a.disabled}
              title={a.disabled ? a.disabledReason : undefined}
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
            >
              {a.icon && <a.icon size={14} />}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
