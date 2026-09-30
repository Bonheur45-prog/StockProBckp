import { Check } from "lucide-react";
import styles from "./StepIndicator.module.css";

/**
 * steps: [{ label }]. current is a 1-based step number. A step before
 * current renders as completed (checkmark), current is highlighted,
 * anything after is upcoming/greyed — same visual language as the
 * Nihemart reference this was modeled on.
 */
export default function StepIndicator({ steps, current }) {
  return (
    <div className={styles.wrap}>
      {steps.map((step, i) => {
        const num = i + 1;
        const state = num < current ? "done" : num === current ? "active" : "upcoming";
        return (
          <div className={styles.step} key={step.label}>
            <div className={styles.stepInner}>
              <div className={`${styles.circle} ${styles[state]}`}>
                {state === "done" ? <Check size={14} /> : num}
              </div>
              <span className={`${styles.label} ${state === "upcoming" ? styles.labelMuted : ""}`}>{step.label}</span>
            </div>
            {i < steps.length - 1 && <div className={`${styles.line} ${num < current ? styles.lineDone : ""}`} />}
          </div>
        );
      })}
    </div>
  );
}