import { Link } from "react-router-dom";
import {
  WifiOff, ScanBarcode, BarChart3, Users, ShieldCheck, Award,
  Check, ArrowRight, Menu, X, Wallet, Smartphone, CreditCard, FileText,
  Upload, Rocket, ChevronDown, Mail, Phone, Landmark, BadgeCheck, Percent,
  MessageSquare, Zap, LayoutGrid, Sun, Calendar, Tag, HelpCircle, Send,
  MapPin, MessageCircle
} from "lucide-react";
import { SiFacebook, SiInstagram } from 'react-icons/si';
import { FaTwitter, FaLinkedin } from 'react-icons/fa';

import { useState, useEffect, useRef } from "react";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Landing.module.css";

// Every picture on the landing page lives in client/public/images/.
// To change one: replace the file with the same name, or point the path here
// at a new file (e.g. "/images/till-day-v2.jpg" so browsers don't show the old one).
const IMAGES = {
  heroBg: "/images/hero-bg.jpg",       // dark photo behind the hero (wide, 1920px+ works best)
  heroPhone: "/images/hero-pos.png",   // picture on the right of the hero (tall frame, 4:5)
  till: "/images/till-day.jpg",        // "A day at the till" picture (square frame, 1:1)
};

// How each picture is fitted into its frame. Pictures can be ANY size or shape;
// the frame never changes shape and the picture is never stretched.
//   "fill"  - the picture fills the frame and the edges are trimmed (default).
//   "whole" - the entire picture is shown, centred, over a blurred copy of itself.
const IMAGE_FIT = {
  heroPhone: "fill",
  till: "whole",   // code screenshot: show the whole thing, never crop off a field
};

// Which part of the picture stays visible when it is trimmed ("fill" only).
//   "auto" - decides by itself: a wide picture in a tall frame keeps its top-left
//            corner (where the menu and headline of a screenshot are), a tall picture
//            keeps its top, and a picture of a similar shape keeps its centre.
//   or set your own: "50% 50%" = centre, "0% 0%" = top-left, "100% 0%" = top-right,
//   "50% 0%" = top, "50% 100%" = bottom.
const IMAGE_FOCUS = {
  heroPhone: "auto",
  till: "auto",
};

// A fixed-shape box that shows a picture of ANY size or shape properly.
// The shape of the box comes from the CSS class you pass in (heroFrame, tillFrame).
function MediaFrame({ src, alt, className, focus = "auto", fit = "fill", loading }) {
  const frameRef = useRef(null);
  const imgRef = useRef(null);
  const [position, setPosition] = useState("50% 50%");

  function decide(img) {
    if (focus !== "auto") {
      setPosition(focus);
      return;
    }
    const frame = frameRef.current;
    if (!frame || !img.naturalWidth || !frame.clientWidth || !frame.clientHeight) return;
    const drift = (img.naturalWidth / img.naturalHeight) / (frame.clientWidth / frame.clientHeight);
    if (drift > 1.3) setPosition("0% 0%");        // much wider than the frame
    else if (drift < 1 / 1.3) setPosition("50% 0%"); // much taller than the frame
    else setPosition("50% 50%");
  }

  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete) decide(img);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, focus]);

  return (
    <div
      ref={frameRef}
      className={`${styles.mediaFrame} ${className}`}
      data-fit={fit === "whole" ? "contain" : "cover"}
      style={{ "--focus": position }}
    >
      <img className={styles.mediaBackdrop} src={src} alt="" aria-hidden="true" loading={loading} />
      <img
        ref={imgRef}
        className={styles.mediaMain}
        src={src}
        alt={alt}
        loading={loading}
        onLoad={(e) => decide(e.currentTarget)}
      />
    </div>
  );
}

function Eyebrow({ icon: Icon, label }) {
  return (
    <div className={styles.eyebrow}>
      <Icon size={13} />
      <span>{label}</span>
    </div>
  );
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Fades a section up into view the first time it scrolls on screen. Skips
// itself entirely (shows content immediately, no animation) if the visitor's
// OS has "reduce motion" turned on.
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      el.classList.add(styles.revealed);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add(styles.revealed);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

const FEATURES = [
  {
    icon: WifiOff,
    title: "Works with no signal",
    description: "Sell, restock, and adjust stock with zero connection. Everything syncs automatically the moment you're back online — nothing waits on the network.",
  },
  {
    icon: ScanBarcode,
    title: "Barcode scanning, built in",
    description: "Scan a product straight into a sale, a restock, or your catalog using your phone's camera — no separate scanner hardware required.",
  },
  {
    icon: BarChart3,
    title: "Reports that actually help",
    description: "Sales trends, top products, and low-stock alerts — filterable by day, month, or year, with the ability to look back at any past period.",
  },
  {
    icon: Users,
    title: "Customer credit accounts",
    description: "Track who's buying on credit and what they owe, with a running balance and payment history — no more relying on a notebook.",
  },
  {
    icon: ShieldCheck,
    title: "A full audit trail",
    description: "Every stock change and sale is logged with who did it and when. Know exactly what happened on your shift, even when you weren't there.",
  },
  {
    icon: Award,
    title: "Staff performance",
    description: "See sales, items sold, and revenue by team member — so you know how the shop is actually running, not just what's in the till.",
  },
];

// Live items reflect what's actually built today (checked directly against
// server/src/models/Sale.js: paymentMethod enum is cash / mobile_money / card
// / credit — no bank transfer field exists yet). comingSoon items are on the
// roadmap per Bright Link — each renders a small "Coming soon" badge. Flip
// comingSoon to false the day the real feature ships; no copy rewrite needed.
const PAYMENTS = [
  { icon: Wallet, title: "Cash", description: "Log it at the register — no extra step.", comingSoon: false },
  { icon: Smartphone, title: "Mobile money", description: "MTN, Airtel, or any provider — recorded as mobile money at checkout.", comingSoon: false },
  { icon: CreditCard, title: "Card", description: "If your store takes cards, log it the same way.", comingSoon: false },
  { icon: Landmark, title: "Bank transfer", description: "Match incoming transfers against a sale by reference.", comingSoon: true },
  { icon: Users, title: "Credit accounts", description: "Let trusted customers buy now, pay later, with a running balance.", comingSoon: false },
  { icon: BadgeCheck, title: "RRA TIN", description: "On every invoice, automatically.", comingSoon: true },
  { icon: Percent, title: "VAT", description: "Calculated for you, not by hand.", comingSoon: true },
  { icon: FileText, title: "PDF reports", description: "Export a clean PDF of any report in one click.", comingSoon: false },
  { icon: MessageSquare, title: "Email & SMS receipts", description: "Send a receipt straight to the customer.", comingSoon: true },
];

const STEPS = [
  {
    icon: Rocket,
    day: "Day 1",
    title: "Create your store",
    description: "Sign up, no card required — your store is ready in minutes.",
  },
  {
    icon: Upload,
    day: "Day 2",
    title: "Import your inventory",
    description: "Bulk-upload your product list from a CSV, or add items one by one with barcode scanning.",
  },
  {
    icon: ScanBarcode,
    day: "Day 3",
    title: "Start selling",
    description: "Ring up your first real sale at the register — online or off.",
  },
];

const FAQS = [
  {
    question: "How long is the free trial, and what's included?",
    answer: "14 days, everything unlocked, no card required. See if it actually fits how your store runs before you pay anything.",
  },
  {
    question: "Does it really work with no internet at all?",
    answer: "Yes. Sales, restocks, and stock adjustments all work fully offline on the device you're using, and sync automatically the moment you're back on the network.",
  },
  {
    question: "Can I bring in my existing product list?",
    answer: "Yes — import your products in bulk from a CSV file instead of typing each one in by hand.",
  },
  {
    question: "What if I have more than one till or staff member?",
    answer: "StockPro is built for multiple devices per store. Every cashier's till syncs back to the same store record, so your reports reflect all of them together.",
  },
  {
    question: "Is there a setup fee?",
    answer: "No. 0 RWF to set up a store, on any plan.",
  },
];

const PRODUCT_RANGES = ["Under 50", "50 – 200", "200 – 500", "500+"];

const PLANS = [
  {
    name: "Free Trial",
    price: "0",
    period: "for 14 days",
    description: "Everything unlocked, no card required — see if it fits your store.",
    features: ["1 team member", "Up to 50 products", "POS, stock & barcode scanning", "Sales reports"],
    cta: "Start free trial",
  },
  {
    name: "Pro",
    price: "20,000",
    period: "/ month",
    description: "For a store running day-to-day sales with a small team.",
    features: ["Up to 5 team members", "Unlimited products", "Customer credit accounts", "Staff performance", "PDF report export"],
    cta: "Start free trial",
    highlighted: true,
  },
  {
    name: "Premium",
    price: "35,000",
    period: "/ month",
    description: "For multiple staff and a store that wants full visibility.",
    features: ["Unlimited team members", "Everything in Pro", "Priority support", "Early access to new features"],
    cta: "Start free trial",
  },
];

export default function Landing() {
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);

  // Parallax: transform-based (not background-attachment: fixed), because
  // fixed backgrounds don't render on iOS Safari — this works on every device.
  // Skipped entirely under prefers-reduced-motion.
  const heroImgRef = useRef(null);
  useEffect(() => {
    if (reducedMotion()) return;
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        if (heroImgRef.current) {
          heroImgRef.current.style.transform = `translateY(${window.scrollY * 0.35}px)`;
        }
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const paymentsReveal = useReveal();
  const featuresReveal = useReveal();
  const narrativeReveal = useReveal();
  const timelineReveal = useReveal();
  const pricingReveal = useReveal();
  const faqReveal = useReveal();
  const contactReveal = useReveal();

  // TODO: no backend endpoint exists for this yet (checked server/src/routes —
  // there's no /contact route). This falls back to a mailto: link, which
  // genuinely opens the visitor's email client rather than faking a "sent"
  // state. Replace with a real endpoint (or a service like Formspree) if you
  // want submissions to land as trackable leads instead.
  const [contactForm, setContactForm] = useState({
    name: "", storeName: "", email: "", phone: "", productsRange: "", message: "",
  });

  function handleContactChange(e) {
    setContactForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleContactSubmit(e) {
    e.preventDefault();
    const subject = encodeURIComponent(`StockPro inquiry from ${contactForm.name || "website visitor"}`);
    const body = encodeURIComponent(
      `Store: ${contactForm.storeName}\n` +
      `Products stocked: ${contactForm.productsRange}\n` +
      `Phone: ${contactForm.phone}\n\n` +
      `${contactForm.message}\n\n` +
      `— ${contactForm.name} (${contactForm.email})`
    );
    window.location.href = `mailto:brighttlink@gmail.com?subject=${subject}&body=${body}`;
  }

  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>SP</span>
            <span className={styles.brandName}>StockPro</span>
          </div>

          <nav className={styles.navLinks}>
            <a href="#features">Features</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
            <a href="#contact">Contact</a>
          </nav>

          <div className={styles.navActions}>
            {isAuthenticated ? (
              <Link to="/app" className={styles.btnAccent}>Go to Dashboard</Link>
            ) : (
              <>
                <Link to="/login" className={styles.btnGhost}>Log in</Link>
                <Link to="/register" className={styles.btnAccent}>Start free trial</Link>
              </>
            )}
          </div>

          <button className={styles.menuToggle} onClick={() => setMenuOpen((m) => !m)}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {menuOpen && (
          <div className={styles.mobileMenu}>
            <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)}>Pricing</a>
            <a href="#faq" onClick={() => setMenuOpen(false)}>FAQ</a>
            <a href="#contact" onClick={() => setMenuOpen(false)}>Contact</a>
            {isAuthenticated ? (
              <Link to="/app" onClick={() => setMenuOpen(false)}>Go to Dashboard</Link>
            ) : (
              <>
                <Link to="/login" onClick={() => setMenuOpen(false)}>Log in</Link>
                <Link to="/register" onClick={() => setMenuOpen(false)}>Start free trial</Link>
              </>
            )}
          </div>
        )}
      </header>

      {/* Parallax hero. Drop your background photo at:
          client/public/images/hero-bg.jpg
          Recommended: a wide landscape shot (1920px+ wide), interior/shelving/
          warehouse style works best — the dark gradient overlay below handles
          text contrast regardless of how bright the photo is. */}
      <section className={styles.heroParallax}>
        <div
          ref={heroImgRef}
          className={styles.heroParallaxImg}
          style={{ backgroundImage: `url(${IMAGES.heroBg})` }}
        />
        <div className={styles.heroParallaxOverlay} />

        <div className={styles.heroContent}>
          <div className={styles.heroInner}>
            <div className={styles.heroText}>
              <h1>Stock and sales, handled — even when the signal drops.</h1>
              <p>
                StockPro is a point-of-sale and inventory system built for hardware stores. Sell, restock,
                and track credit customers from a phone or tablet, online or off, with everything syncing
                the moment you're back on the network.
              </p>
              <div className={styles.heroActions}>
                <Link to="/register" className={styles.btnAccentLg}>
                  Start your free 14-day trial <ArrowRight size={16} />
                </Link>
                <a href="#features" className={styles.btnGhostLgDark}>See how it works</a>
              </div>
              <p className={styles.heroHint}>No card required. Set up your store in under a minute.</p>
            </div>

            <div className={styles.heroVisual}>
              <MediaFrame
                className={styles.heroFrame}
                src={IMAGES.heroPhone}
                alt="The StockPro dashboard showing sales, revenue and items sold"
                fit={IMAGE_FIT.heroPhone}
                focus={IMAGE_FOCUS.heroPhone}
              />
            </div>
          </div>

          <div className={styles.statsBar}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>100%</span>
              <span className={styles.statLabel}>Works fully offline</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>0 RWF</span>
              <span className={styles.statLabel}>Setup fee, ever</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>Unlimited</span>
              <span className={styles.statLabel}>Products on Pro &amp; Premium</span>
            </div>
            <div className={styles.statItem}>
              {/* TODO: unverified — confirm a real onboarding time or store count
                  before publishing. Left visible on purpose. */}
              <span className={styles.statValue}>TODO</span>
              <span className={styles.statLabel}>min to set up a store</span>
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.payments} ${styles.reveal}`} ref={paymentsReveal}>
        <Eyebrow icon={Zap} label="BUILT FOR RWANDA" />
        <h2>Plays well with how you already get paid</h2>
        <p className={styles.sectionSub}>
          Cash, mobile money, card, or credit on account — log it however the sale actually happened.
        </p>
        <div className={styles.paymentsGrid}>
          {PAYMENTS.map(({ icon: Icon, title, description, comingSoon }) => (
            <div key={title} className={styles.paymentCard}>
              <div className={styles.paymentIcon}><Icon size={18} /></div>
              <div>
                <h3>
                  {title}
                  {comingSoon && <span className={styles.soonBadge}>Coming soon</span>}
                </h3>
                <p>{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="features" className={`${styles.features} ${styles.reveal}`} ref={featuresReveal}>
        <Eyebrow icon={LayoutGrid} label="EVERYTHING IN ONE PLACE" />
        <h2>Built for how a hardware store actually runs</h2>
        <div className={styles.featureGrid}>
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className={styles.featureCard}>
              <div className={styles.featureIcon}><Icon size={20} /></div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={`${styles.narrative} ${styles.reveal}`} ref={narrativeReveal}>
        <div className={styles.narrativeInner}>
          <MediaFrame
            className={styles.tillFrame}
            src={IMAGES.till}
            alt="The saved record of a completed 12,500 RWF mobile money sale"
            fit={IMAGE_FIT.till}
            focus={IMAGE_FOCUS.till}
            loading="lazy"
          />
          <div className={styles.narrativeText}>
            <Eyebrow icon={Sun} label="A DAY AT THE TILL" />
            <h2>From "where's the notebook?" to closed by noon.</h2>
            <ul className={styles.narrativeList}>
              <li>
                <Check size={16} />
                <span>Every sale is logged the moment it happens — no end-of-day scramble to remember what sold.</span>
              </li>
              <li>
                <Check size={16} />
                <span>Stock and credit balances update themselves — nobody re-types anything into a notebook.</span>
              </li>
              <li>
                <Check size={16} />
                <span>Closing out the till takes minutes, not an hour of cross-checking receipts.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section id="how-it-works" className={`${styles.timeline} ${styles.reveal}`} ref={timelineReveal}>
        <Eyebrow icon={Calendar} label="GO LIVE THIS WEEK" />
        <h2>Three steps. Same week.</h2>
        <p className={styles.sectionSub}>No long migration — bring last month's habits, not last month's mess.</p>
        <div className={styles.timelineGrid}>
          {STEPS.map(({ icon: Icon, day, title, description }) => (
            <div key={day} className={styles.timelineCard}>
              <div className={styles.timelineIcon}><Icon size={18} /></div>
              <span className={styles.timelineDay}>{day}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className={`${styles.pricing} ${styles.reveal}`} ref={pricingReveal}>
        <Eyebrow icon={Tag} label="PRICING" />
        <h2>Simple pricing, start free</h2>
        <p className={styles.pricingSub}>Every plan starts with a 14-day free trial. No card required to begin.</p>
        <div className={styles.plansGrid}>
          {PLANS.map((plan) => (
            <div key={plan.name} className={styles.planCard} data-highlighted={!!plan.highlighted}>
              {plan.highlighted && <span className={styles.planBadge}>Most popular</span>}
              <h3>{plan.name}</h3>
              <div className={styles.planPrice}>
                <span className={styles.planAmount}>{plan.price} RWF</span>
                <span className={styles.planPeriod}>{plan.period}</span>
              </div>
              <p className={styles.planDescription}>{plan.description}</p>
              <ul className={styles.planFeatures}>
                {plan.features.map((f) => (
                  <li key={f}><Check size={14} /> {f}</li>
                ))}
              </ul>
              <Link to="/register" className={plan.highlighted ? styles.btnAccent : styles.btnGhost}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className={`${styles.faq} ${styles.reveal}`} ref={faqReveal}>
        <Eyebrow icon={HelpCircle} label="FAQS" />
        <h2>Frequently asked questions</h2>
        <div className={styles.faqList}>
          {FAQS.map((item, i) => {
            const isOpen = openFaq === i;
            return (
              <div key={item.question} className={styles.faqItem}>
                <button
                  type="button"
                  className={styles.faqQuestion}
                  onClick={() => setOpenFaq(isOpen ? null : i)}
                  aria-expanded={isOpen}
                >
                  <span>{item.question}</span>
                  <ChevronDown size={18} className={styles.faqChevron} data-open={isOpen} />
                </button>
                <div className={styles.faqAnswerWrap} data-open={isOpen}>
                  <div className={styles.faqAnswerInner}>
                    <p className={styles.faqAnswer}>{item.answer}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section id="contact" className={`${styles.contact} ${styles.reveal}`} ref={contactReveal}>
        <Eyebrow icon={Send} label="TALK TO US" />
        <h2 className={styles.contactHeading}>Tell us about your store.</h2>
        <p className={styles.contactSub}>
          Questions about pricing, migrating your product list, or anything else — reach out directly.
        </p>

        <div className={styles.contactCards}>
          <div className={styles.contactCard}>
            <div className={styles.contactCardIcon}><Phone size={16} /></div>
            <div>
              <span className={styles.contactCardLabel}>CALL US</span>
              <strong>+250 795 263 269</strong>
              <strong>+250 782 567 921</strong>
            </div>
          </div>
          <div className={styles.contactCard}>
            <div className={styles.contactCardIcon}><MessageCircle size={16} /></div>
            <div>
              <span className={styles.contactCardLabel}>WHATSAPP</span>
              <strong>+250 795 263 269</strong>
              <strong>+250 782 567 921</strong>
              <p>Fastest way to reach us</p>
            </div>
          </div>
          <div className={styles.contactCard}>
            <div className={styles.contactCardIcon}><Mail size={16} /></div>
            <div>
              <span className={styles.contactCardLabel}>EMAIL</span>
              <strong>brighttlink@gmail.com</strong>
              <p>We reply as soon as we can</p>
            </div>
          </div>
          <div className={styles.contactCard}>
            <div className={styles.contactCardIcon}><MapPin size={16} /></div>
            <div>
              <span className={styles.contactCardLabel}>OFFICE</span>
              <strong>Kicukiro, Kigali City, Rwanda (KK 21 St)</strong>
              <p>BrightLink Technologies Ltd</p>
            </div>
          </div>
        </div>

        <div className={styles.statusPill}>
          <span className={styles.statusDot} />
          Usually online during business hours
        </div>

        <form className={styles.contactForm} onSubmit={handleContactSubmit}>
          <div className={styles.contactFormGrid}>
            <label>
              Your name
              <input type="text" name="name" required value={contactForm.name} onChange={handleContactChange} />
            </label>
            <label>
              Store name
              <input type="text" name="storeName" value={contactForm.storeName} onChange={handleContactChange} />
            </label>
            <label>
              Email
              <input type="email" name="email" required value={contactForm.email} onChange={handleContactChange} />
            </label>
            <label>
              Phone
              <input type="tel" name="phone" value={contactForm.phone} onChange={handleContactChange} />
            </label>
          </div>

          <label>
            How many products do you stock?
            <select name="productsRange" value={contactForm.productsRange} onChange={handleContactChange}>
              <option value="">Pick a range</option>
              {PRODUCT_RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>

          <label>
            Anything we should know?
            <textarea
              name="message"
              rows={4}
              required
              placeholder="Tell us how you track stock today, what's frustrating, what'd make this a yes."
              value={contactForm.message}
              onChange={handleContactChange}
            />
          </label>

          <button type="submit" className={styles.btnAccent}>Send message <Send size={14} /></button>
          <p className={styles.privacyNote}>
            Your info stays with us. We don't share, sell, or use it outside this conversation.
          </p>
        </form>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div className={styles.footerBrandCol}>
            <div className={styles.brand}>
              <span className={styles.brandMark}>SP</span>
              <span className={styles.brandNameLight}>StockPro</span>
            </div>
            <p className={styles.footerTagline}>
              One simple system for stock, sales, staff and reports — built offline-first, for Rwanda.
            </p>
            <div className={styles.footerSocials}>
              {/* Real, working link — uses the actual WhatsApp number. */}
              <a
                href="https://wa.me/250795263269"
                target="_blank"
                rel="noreferrer"
                className={styles.socialIcon}
                aria-label="WhatsApp"
              >
                <MessageCircle size={16} />
              </a>
              {/* TODO: these four have no real handle yet — wire up the real
                  profile URLs once they exist, or remove the ones you won't use. */}
              <a href="#" className={styles.socialIcon} aria-label="Twitter / X"><FaTwitter size={16} /></a>
              <a href="https://www.linkedin.com/company/brightlink-technologies-ltd" className={styles.socialIcon} aria-label="LinkedIn"><FaLinkedin size={16} /></a>
              <a href="https://www.instagram.com/brightlink_technologies/" className={styles.socialIcon} aria-label="Instagram"><SiInstagram size={16} /></a>
              <a href="#" className={styles.socialIcon} aria-label="Facebook"><SiFacebook  size={16} /></a>
            </div>
          </div>

          <div className={styles.footerCol}>
            <span className={styles.footerColTitle}>PRODUCT</span>
            <a href="#features">What's inside</a>
            <a href="#how-it-works">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">Questions, answered</a>
          </div>

          <div className={styles.footerCol}>
            <span className={styles.footerColTitle}>COMPANY</span>
            <a href="#contact">Contact us</a>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
          </div>

          <div className={styles.footerCol}>
            <span className={styles.footerColTitle}>GET IN TOUCH</span>
            <span className={styles.footerContactLine}>
              <MapPin size={14} /> Kicukiro, Kigali City, Rwanda
            </span>
            <span className={styles.footerContactLine}>
              <Phone size={14} /> +250 795 263 269
            </span>
            <span className={styles.footerContactLine}>
              <Mail size={14} /> brighttlink@gmail.com
            </span>
          </div>
        </div>

        <div className={styles.footerInner}>
          <p className={styles.footerCopy}>
            © {new Date().getFullYear()} StockPro. A product of <strong>BrightLink Technologies Ltd</strong>. All rights reserved.
          </p>
          <div className={styles.footerLinks}>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}