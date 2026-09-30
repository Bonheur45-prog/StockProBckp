import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, Store as StoreIcon } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { Card, Field, Input, Select, Button } from "../../components/ui/ui.jsx";
import StepIndicator from "../../components/StepIndicator/StepIndicator.jsx";
import { deriveSkuPrefix } from "../../lib/skuGen.js";
import styles from "./Auth.module.css";

const STEPS = [{ label: "Business" }, { label: "Location" }, { label: "Preferences" }, { label: "Review" }];

const BUSINESS_TYPES = [
  "Hardware & Electrical",
  "Grocery & Food",
  "Pharmacy",
  "Fashion & Apparel",
  "Electronics",
  "Restaurant & Bar",
  "Beauty & Cosmetics",
  "General Retail",
  "Other",
];

const initialForm = {
  storeName: "",
  businessType: "",
  tin: "",
  ownerName: "",
  email: "",
  password: "",
  address: "",
  phone: "",
  currency: "RWF",
  skuPrefix: "",
  lowStockThresholdDefault: 5,
};

export default function Register() {
  const { registerStore, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState("");
  const [skuPrefixTouched, setSkuPrefixTouched] = useState(false);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const effectiveSkuPrefix = skuPrefixTouched ? form.skuPrefix : deriveSkuPrefix(form.storeName);

  function validateStep(n) {
    if (n === 1) {
      if (!form.storeName || !form.ownerName || !form.email || !form.password) {
        return "Store name, your name, email and password are required.";
      }
      if (form.password.length < 8) return "Password must be at least 8 characters.";
    }
    return "";
  }

  function goNext() {
    const msg = validateStep(step);
    if (msg) {
      setError(msg);
      return;
    }
    setError("");
    setStep((s) => Math.min(s + 1, STEPS.length));
  }

  function goBack() {
    setError("");
    setStep((s) => Math.max(s - 1, 1));
  }

  async function handlePrimaryAction() {
    if (step < STEPS.length) {
      goNext();
      return;
    }
    setError("");
    try {
      await registerStore({ ...form, skuPrefix: effectiveSkuPrefix });
      navigate("/app");
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't create your store. Please try again.");
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.brandSide}>
        <div className={styles.brandMark}>SP</div>
        <h1>StockPro</h1>
        <p>Run any kind of business — retail, food, pharmacy, and more. Free to start, no card required.</p>
      </div>

      <Card className={styles.formCard}>
        <h2>Create your store</h2>
        <StepIndicator steps={STEPS} current={step} />

        <form onSubmit={(e) => e.preventDefault()} className={styles.form}>
          {step === 1 && (
            <>
              <Field label="Store name">
                <Input required value={form.storeName} onChange={(e) => update("storeName", e.target.value)} placeholder="Sunrise Hardware" />
              </Field>
              <Field label="Business type">
                <Select value={form.businessType} onChange={(e) => update("businessType", e.target.value)}>
                  <option value="">Select a type</option>
                  {BUSINESS_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </Select>
              </Field>
              <Field label="TIN" hint="Optional — Rwanda Revenue Authority Tax ID, if you have one">
                <Input value={form.tin} onChange={(e) => update("tin", e.target.value)} placeholder="1XXXXXXXXX" />
              </Field>
              <Field label="Your name">
                <Input required value={form.ownerName} onChange={(e) => update("ownerName", e.target.value)} placeholder="Jane Doe" />
              </Field>
              <Field label="Email">
                <Input type="email" required value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="you@store.com" />
              </Field>
              <Field label="Password" hint="At least 8 characters">
                <Input type="password" required minLength={8} value={form.password} onChange={(e) => update("password", e.target.value)} placeholder="••••••••" />
              </Field>
            </>
          )}

          {step === 2 && (
            <>
              <Field label="Address" hint="Optional — shown on receipts and your public product pages">
                <Input value={form.address} onChange={(e) => update("address", e.target.value)} placeholder="KG 11 Ave, Kigali" />
              </Field>
              <Field label="Phone" hint="Optional — used for the Call/WhatsApp buttons on public product pages">
                <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="+250 7XX XXX XXX" />
              </Field>
              <Field label="Currency">
                <Input value={form.currency} onChange={(e) => update("currency", e.target.value.toUpperCase())} maxLength={6} placeholder="RWF" />
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <Field label="SKU prefix" hint="Used when generating SKUs, e.g. BHS-ELE-0001 — auto-suggested from your store name, editable">
                <Input
                  value={effectiveSkuPrefix}
                  onChange={(e) => {
                    setSkuPrefixTouched(true);
                    update("skuPrefix", e.target.value.toUpperCase());
                  }}
                  maxLength={4}
                />
              </Field>
              <Field label="Low stock alert" hint="Default threshold for new products — you can override this per product later">
                <Input
                  type="number"
                  min={0}
                  value={form.lowStockThresholdDefault}
                  onChange={(e) => update("lowStockThresholdDefault", Number(e.target.value))}
                />
              </Field>
            </>
          )}

          {step === 4 && (
            <div className={styles.review}>
              <ReviewRow label="Store name" value={form.storeName} />
              <ReviewRow label="Business type" value={form.businessType || "—"} />
              <ReviewRow label="TIN" value={form.tin || "—"} />
              <ReviewRow label="Owner" value={form.ownerName} />
              <ReviewRow label="Email" value={form.email} />
              <ReviewRow label="Address" value={form.address || "—"} />
              <ReviewRow label="Phone" value={form.phone || "—"} />
              <ReviewRow label="Currency" value={form.currency} />
              <ReviewRow label="SKU prefix" value={effectiveSkuPrefix} />
              <ReviewRow label="Low stock alert" value={form.lowStockThresholdDefault} />
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.stepActions}>
            {step > 1 ? (
              <Button type="button" variant="ghost" onClick={goBack}>
                <ArrowLeft size={16} /> Back
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" variant="accent" size={step === STEPS.length ? "lg" : "md"} disabled={loading} onClick={handlePrimaryAction}>
              {step < STEPS.length ? (
                <>Next <ArrowRight size={16} /></>
              ) : loading ? (
                "Creating…"
              ) : (
                <><StoreIcon size={16} /> Create store</>
              )}
            </Button>
          </div>
        </form>

        <p className={styles.switch}>
          Already set up? <Link to="/login">Sign in</Link>
        </p>
      </Card>
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className={styles.reviewRow}>
      <span className={styles.reviewLabel}>{label}</span>
      <span className={styles.reviewValue}>{value}</span>
    </div>
  );
}