import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./TrialBadge.module.css";

export default function TrialBadge() {
  const { store } = useAuth();

  if (!store?.trialEndsAt) return null;
  // Once a store is on a real paid plan, the trial clock is irrelevant.
  if (store.plan && store.plan !== "free") return null;

  const daysLeft = Math.ceil((new Date(store.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  if (daysLeft > 0) {
    return (
      <span className={styles.badge} data-tone={daysLeft <= 3 ? "urgent" : "default"}>
        <Clock size={13} />
        {daysLeft} day{daysLeft === 1 ? "" : "s"} left in trial
      </span>
    );
  }

  // No enforcement yet — this is purely informational until billing exists.
  return (
    <span className={styles.badge} data-tone="urgent">
      <Clock size={13} />
      Trial ended
      <Link to="/#pricing" className={styles.link} target="_blank" rel="noopener">See plans</Link>
    </span>
  );
}
