import styles from "./ui.module.css";

export function Card({ children, className = "", ...props }) {
  return (
    <div className={`${styles.card} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Button({ children, variant = "primary", size = "md", className = "", ...props }) {
  return (
    <button className={`${styles.btn} ${styles[`btn_${variant}`]} ${styles[`btn_${size}`]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Field({ label, error, children, hint }) {
  return (
    <label className={styles.field}>
      {label && <span className={styles.fieldLabel}>{label}</span>}
      {children}
      {hint && !error && <span className={styles.fieldHint}>{hint}</span>}
      {error && <span className={styles.fieldError}>{error}</span>}
    </label>
  );
}

export function Input(props) {
  return <input className={styles.input} {...props} />;
}

export function Select(props) {
  return <select className={styles.input} {...props} />;
}

export function TextArea(props) {
  return <textarea className={styles.input} {...props} />;
}

export function Badge({ children, tone = "neutral" }) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className={styles.empty}>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
