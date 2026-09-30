import { Link } from "react-router-dom";
import styles from "./Legal.module.css";

export default function Terms() {
  return (
    <div className={styles.page}>
      <div className={styles.nav}>
        <Link to="/" className={styles.navInner}>
          <span className={styles.brandMark}>SP</span>
          <span className={styles.brandName}>StockPro</span>
        </Link>
      </div>

      <div className={styles.content}>
        <h1>Terms of Service</h1>
        <p className={styles.updated}>Last updated: {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>

        <h2>1. What StockPro is</h2>
        <p>
          StockPro is a point-of-sale and inventory management service for retail stores, provided as
          software-as-a-service. You create a "store" account, invite your team, and use the service to
          record sales, manage stock, and view reports for that store.
        </p>

        <h2>2. Your account and store</h2>
        <p>
          You're responsible for the accuracy of the information you enter, for keeping your login
          credentials secure, and for what happens under your account. If you invite teammates, you're
          responsible for their access and for removing it when appropriate. One store may have multiple
          team members with different roles (owner, manager, cashier), each with different permissions
          within the service.
        </p>

        <h2>3. Free trial and subscriptions</h2>
        <p>
          New stores begin with a free trial period. At the end of the trial, continued use of paid
          features may require a subscription. Pricing, billing terms, and payment methods will be
          presented separately before any charge is made — nothing is billed automatically without your
          agreement.
        </p>

        <h2>4. Acceptable use</h2>
        <p>You agree not to use StockPro to:</p>
        <ul>
          <li>Store or process data you don't have the right to store or process</li>
          <li>Attempt to access another store's data without authorization</li>
          <li>Interfere with or disrupt the service or its infrastructure</li>
          <li>Use the service for any unlawful purpose</li>
        </ul>

        <h2>5. Your data</h2>
        <p>
          You own the data you enter into your store — your products, sales, customers, and records. We
          don't claim ownership of it. See our <Link to="/privacy">Privacy Policy</Link> for details on
          how it's stored and processed.
        </p>

        <h2>6. Offline functionality</h2>
        <p>
          StockPro is designed to keep working without an internet connection, storing data locally on
          your device and syncing it to our servers once you're back online. You're responsible for the
          security of devices used to access your store, since offline data is cached on that device.
        </p>

        <h2>7. Service availability</h2>
        <p>
          We aim to keep the service available and reliable, but we don't guarantee uninterrupted access.
          We may need to perform maintenance, and functionality may change as the service evolves.
        </p>

        <h2>8. Termination</h2>
        <p>
          You may stop using the service at any time. We may suspend or terminate access for accounts that
          violate these terms. If your subscription lapses, we'll give reasonable notice before any store
          data is deleted.
        </p>

        <h2>9. Limitation of liability</h2>
        <p>
          The service is provided "as is." To the extent permitted by law, we aren't liable for indirect,
          incidental, or consequential damages arising from your use of the service, including loss of
          data, revenue, or business.
        </p>

        <h2>10. Changes to these terms</h2>
        <p>
          We may update these terms from time to time. Continued use of the service after a change means
          you accept the updated terms.
        </p>

        <h2>11. Contact</h2>
        <p>Questions about these terms? Reach out to us at the contact details provided on our website.</p>
      </div>
    </div>
  );
}
