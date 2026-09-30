import { Link } from "react-router-dom";
import styles from "./Legal.module.css";

export default function Privacy() {
  return (
    <div className={styles.page}>
      <div className={styles.nav}>
        <Link to="/" className={styles.navInner}>
          <span className={styles.brandMark}>SP</span>
          <span className={styles.brandName}>StockPro</span>
        </Link>
      </div>

      <div className={styles.content}>
        <h1>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>

        <h2>1. What we collect</h2>
        <p>To provide the service, we collect and store:</p>
        <ul>
          <li><strong>Account information:</strong> your name, email, and password (stored as a secure hash, never in plain text)</li>
          <li><strong>Store data:</strong> your store's name, address, and settings</li>
          <li><strong>Business data:</strong> the products, stock movements, sales, and customer credit records you enter</li>
          <li><strong>Product photos:</strong> images you upload for your catalog</li>
          <li><strong>Usage data:</strong> a log of significant actions (who created, edited, or deleted what, and when) for accountability within your store</li>
        </ul>

        <h2>2. How we use it</h2>
        <p>
          We use this data to provide the service to you — running your store's dashboard, reports, and
          sync — and for nothing else. We don't sell your data, and we don't use your business data to
          train unrelated products.
        </p>

        <h2>3. Where it's stored</h2>
        <p>
          Account and business data is stored in a managed MongoDB database. Product photos are stored and
          processed by Cloudinary, an image hosting provider. Data you create while offline is stored
          locally on your device (in your browser's local storage) until your device reconnects and syncs
          it to our servers.
        </p>

        <h2>4. Data isolation between stores</h2>
        <p>
          Every store's data is scoped and isolated from every other store on the platform. Staff accounts
          only have access to the store(s) they're a member of, based on their assigned role.
        </p>

        <h2>5. Third parties</h2>
        <p>We share data with the following categories of service providers, only as needed to run the service:</p>
        <ul>
          <li>Our database hosting provider (stores your data)</li>
          <li>Cloudinary (stores and compresses product photos)</li>
          <li>A payment processor, if and when you subscribe to a paid plan (handles billing only — we don't store your card details ourselves)</li>
        </ul>
        <p>We don't share your data with advertisers or data brokers.</p>

        <h2>6. Your rights</h2>
        <p>
          You can access, correct, or export your store's data at any time through the app. If you'd like
          your account and store data deleted, contact us and we'll process that request, subject to any
          legal retention requirements.
        </p>

        <h2>7. Data retention</h2>
        <p>
          We retain your data for as long as your account is active. If a subscription lapses, we retain
          data for a reasonable grace period before deletion, so you don't lose access accidentally.
        </p>

        <h2>8. Security</h2>
        <p>
          Passwords are hashed and never stored in plain text. Access to the API requires an authenticated
          session token. We take reasonable technical measures to protect your data, though no system can
          be guaranteed 100% secure.
        </p>

        <h2>9. Changes to this policy</h2>
        <p>We may update this policy as the service evolves. We'll note the date of the most recent update at the top of this page.</p>

        <h2>10. Contact</h2>
        <p>Questions about this policy or your data? Reach out to us at the contact details provided on our website.</p>
      </div>
    </div>
  );
}
