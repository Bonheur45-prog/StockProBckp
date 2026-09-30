import { useEffect, useState, Fragment } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Search, Plus, Minus, Trash2, ShoppingCart, CheckCircle2,
  ChevronDown, ChevronUp, Printer, RotateCcw, Ban, History,
  ScanBarcode, Pencil, PackagePlus, Calculator,
} from "lucide-react";
import { Card, Button, Select, Input, Badge } from "../../components/ui/ui.jsx";
import KebabMenu from "../../components/KebabMenu/KebabMenu.jsx";
import Receipt from "../../components/Receipt/Receipt.jsx";
import BarcodeScanner from "../../components/BarcodeScanner/BarcodeScanner.jsx";
import Pagination from "../../components/Pagination/Pagination.jsx";
import { listProducts, createSale, listSales, voidSaleRemote, findLocalProductByAnyId, findProductByBarcode } from "../../lib/repo.js";
import { extractBarcodeFromScan } from "../../lib/publicLink.js";
import { discardStuckRecord } from "../../lib/sync.js";
import { usePagination } from "../../hooks/usePagination.js";
import { uuid } from "../../lib/uuid.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./POS.module.css";

const DRAFT_KEY = "pos_cart_draft_v1";

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function POS() {
  const { store, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const draft = loadDraft();

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState(draft?.cart || []);
  const [paymentMethod, setPaymentMethod] = useState(draft?.paymentMethod || "cash");
  const [discount, setDiscount] = useState(draft?.discount || "");
  const [customerName, setCustomerName] = useState(draft?.customerName || "");
  const [customerPhone, setCustomerPhone] = useState(draft?.customerPhone || "");
  const [cashReceived, setCashReceived] = useState("");
  const [error, setError] = useState("");
  const [completedSale, setCompletedSale] = useState(null);
  const [charging, setCharging] = useState(false);

  const [sales, setSales] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [receiptSale, setReceiptSale] = useState(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanFeedback, setScanFeedback] = useState(null); // { type: "added"|"missing", text }
  const [customItemOpen, setCustomItemOpen] = useState(false);
  const [customItemForm, setCustomItemForm] = useState({ name: "", unitPrice: "", quantity: "1" });
  const [editingPriceKey, setEditingPriceKey] = useState(null);

  async function load() {
    const items = await listProducts({ search, activeOnly: true });
    setProducts(items.filter((p) => p.quantityOnHand > 0));
  }

  // Showing all 137+ products by default is what made the page tall enough
  // for the Complete Sale button to end up far below the fold in the first
  // place. A cashier types a few letters or scans a barcode to find a
  // specific item anyway, so there's little reason to render the whole
  // catalog before they've asked for it — only the search box needs to see
  // everything.
  const VISIBLE_LIMIT = 12;
  const visibleProducts = search ? products : products.slice(0, VISIBLE_LIMIT);
  const hiddenCount = search ? 0 : Math.max(0, products.length - VISIBLE_LIMIT);

  async function loadHistory() {
    const items = await listSales();
    setSales(items);
  }

  useEffect(() => {
    load();
  }, [search]);

  useEffect(() => {
    loadHistory();
    const interval = setInterval(loadHistory, 5000);
    return () => clearInterval(interval);
  }, []);

  // Coming from the "Couldn't sync" screen's Edit & Retry action. Runs
  // once — the state is cleared from the URL immediately after so a
  // refresh or navigating back here doesn't silently reopen it again.
  useEffect(() => {
    if (location.state?.reopenStuckSale) {
      handleReopenStuckSale(location.state.reopenStuckSale);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state]);

  // Persist the draft sale so a refresh (or an accidental tab close)
  // doesn't lose a cart that hasn't been charged yet.
  useEffect(() => {
    if (cart.length === 0 && !discount && !customerName && !customerPhone) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ cart, paymentMethod, discount, customerName, customerPhone }));
  }, [cart, paymentMethod, discount, customerName, customerPhone]);

  const currency = store?.currency || "RWF";

  function addToCart(product) {
    setCart((c) => {
      const existing = c.find((i) => i.cartKey === product.clientId);
      if (existing) {
        if (existing.quantity >= product.quantityOnHand) return c;
        return c.map((i) => (i.cartKey === product.clientId ? { ...i, quantity: i.quantity + 1 } : i));
      }
      return [
        ...c,
        {
          cartKey: product.clientId,
          productId: product.clientId,
          name: product.name,
          quantity: 1,
          unitPrice: product.sellPrice,
          catalogPrice: product.sellPrice,
          available: product.quantityOnHand,
          isCustom: false,
        },
      ];
    });
  }

  function addCustomItemToCart() {
    const name = customItemForm.name.trim();
    const unitPrice = Number(customItemForm.unitPrice);
    const quantity = Number(customItemForm.quantity) || 1;
    if (!name) return setError("Custom item needs a name");
    if (!unitPrice || unitPrice <= 0) return setError("Custom item needs a valid price");
    setError("");
    setCart((c) => [
      ...c,
      { cartKey: uuid(), name, quantity, unitPrice, catalogPrice: unitPrice, available: Infinity, isCustom: true },
    ]);
    setCustomItemForm({ name: "", unitPrice: "", quantity: "1" });
    setCustomItemOpen(false);
  }

  function changeQty(cartKey, delta) {
    setCart((c) =>
      c
        .map((i) => (i.cartKey === cartKey ? { ...i, quantity: Math.min(i.available, Math.max(1, i.quantity + delta)) } : i))
        .filter((i) => i.quantity > 0)
    );
  }

  function updatePrice(cartKey, newPrice) {
    const price = Number(newPrice);
    setCart((c) => c.map((i) => (i.cartKey === cartKey ? { ...i, unitPrice: isNaN(price) ? i.unitPrice : price } : i)));
  }

  function removeItem(cartKey) {
    setCart((c) => c.filter((i) => i.cartKey !== cartKey));
  }

  async function handleScan(code) {
    const product = await findProductByBarcode(extractBarcodeFromScan(code), { activeOnly: true });
    if (product) {
      if (product.quantityOnHand <= 0) {
        setScanFeedback({ type: "missing", text: `${product.name} is out of stock.` });
        return;
      }
      addToCart(product);
      setScanFeedback({ type: "added", text: `Added: ${product.name}` });
    } else {
      setScanFeedback({ type: "missing", text: `No product found for barcode ${code}.`, unmatchedBarcode: code });
    }
  }

  const subtotal = cart.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const discountNum = discount === "" ? 0 : Number(discount);
  const discountValid = Number.isFinite(discountNum) && discountNum >= 0 && discountNum <= subtotal;
  const total = discountValid ? Math.round((subtotal - discountNum) * 100) / 100 : subtotal;
  const change = paymentMethod === "cash" && cashReceived !== "" ? Number(cashReceived) - total : null;
  // Cash entered but not enough to cover the total — block checkout
  // rather than let the cashier complete a sale for less than what's
  // actually owed. Leaving cashReceived blank is still allowed (assumes
  // exact change, matches how cashiers commonly skip typing it in when
  // there's nothing to calculate).
  const cashInsufficient = paymentMethod === "cash" && change !== null && change < 0;

  async function handleCheckout() {
    setError("");
    if (cart.length === 0) return;
    if (cashInsufficient) return;
    setCharging(true);
    try {
      const sale = await createSale({
        items: cart.map((i) =>
          i.isCustom
            ? { isCustom: true, name: i.name, unitPrice: i.unitPrice, quantity: i.quantity }
            : { productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice }
        ),
        discount: discountNum,
        paymentMethod,
        customerName,
        customerPhone,
      });
      setCompletedSale(sale);
      setCart([]);
      setDiscount("");
      setCustomerName("");
      setCustomerPhone("");
      setCashReceived("");
      localStorage.removeItem(DRAFT_KEY);
      load();
      loadHistory();
    } catch (err) {
      setError(err.message || "Couldn't complete the sale");
    } finally {
      setCharging(false);
    }
  }

  async function handleRepeatSale(sale) {
    const nextCart = [];
    const missing = [];
    for (const item of sale.items) {
      if (item.isCustom) {
        nextCart.push({ cartKey: uuid(), name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, catalogPrice: item.unitPrice, available: Infinity, isCustom: true });
        continue;
      }
      const product = await findLocalProductByAnyId(item.productId);
      if (!product || product.quantityOnHand <= 0) {
        missing.push(item.name);
        continue;
      }
      const quantity = Math.min(item.quantity, product.quantityOnHand);
      nextCart.push({ cartKey: product.clientId, productId: product.clientId, name: product.name, quantity, unitPrice: product.sellPrice, catalogPrice: product.sellPrice, available: product.quantityOnHand, isCustom: false });
    }
    setCart(nextCart);
    setCustomerName(sale.customerName || "");
    setCustomerPhone(sale.customerPhone || "");
    setError(missing.length ? `Skipped (out of stock or removed): ${missing.join(", ")}` : "");
  }

  /**
   * Reopens a permanently-rejected sale (from the "Couldn't sync" screen)
   * as an editable cart, so the cashier can fix whatever the server
   * objected to and check out again through the exact same validation as
   * any other sale — never a special "force it through" path.
   *
   * Deliberately different from handleRepeatSale above in two ways:
   *  - Quantities are NOT silently capped to current stock. Repeating a
   *    past completed sale is "start something new, inspired by the old
   *    one" — quietly adjusting makes sense there. Retrying a stuck sale
   *    needs the cashier to actually SEE the discrepancy (e.g. someone
   *    else sold the rest while this was stuck) and decide what to do,
   *    not have it decided for them. If stock is short, the existing
   *    "Not enough stock for X (have Y)" error on checkout already says
   *    exactly what's wrong — no new mechanism needed for that.
   *  - discount and paymentMethod are carried over too, since those are
   *    plausibly exactly what caused the rejection and are what the
   *    cashier most needs to see and adjust.
   *
   * The old stuck sale is discarded immediately, before the cart is even
   * shown — not after the retry succeeds. It never reached the server
   * (rejected sales never get a server id), so nothing server-side is
   * lost by removing it now. Waiting until after a successful retry would
   * leave a window where both the old sale's optimistic stock decrement
   * and the new one's could be live on this device at once — the old
   * one's product-side effect self-heals on its own on the next sync (see
   * the dirty-flag fix elsewhere this session), but only once that sync
   * actually completes, and there's no guarantee it already has by the
   * time the cashier finishes editing.
   */
  async function handleReopenStuckSale(sale) {
    await discardStuckRecord("sale", sale.clientId);

    const nextCart = [];
    const notes = [];
    for (const item of sale.items) {
      if (item.isCustom) {
        nextCart.push({ cartKey: uuid(), name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, catalogPrice: item.unitPrice, available: Infinity, isCustom: true });
        continue;
      }
      const product = await findLocalProductByAnyId(item.productId);
      if (!product) {
        notes.push(`${item.name} no longer exists — removed from the cart`);
        continue;
      }
      nextCart.push({
        cartKey: product.clientId,
        productId: product.clientId,
        name: product.name,
        quantity: item.quantity, // not capped — see docstring
        unitPrice: item.unitPrice,
        catalogPrice: product.sellPrice,
        available: product.quantityOnHand,
        isCustom: false,
      });
      if (item.quantity > product.quantityOnHand) {
        notes.push(`${product.name}: only ${product.quantityOnHand} in stock now, you had ${item.quantity}`);
      }
    }
    setCart(nextCart);
    setDiscount(sale.discount ? String(sale.discount) : "");
    setPaymentMethod(sale.paymentMethod || "cash");
    setCustomerName(sale.customerName || "");
    setCustomerPhone(sale.customerPhone || "");
    setError(notes.length ? notes.join(" · ") : "");
  }

  async function handleVoid(sale) {
    if (!confirm("Void this sale? Stock will be restored.")) return;
    try {
      await voidSaleRemote(sale);
      loadHistory();
      load();
    } catch (err) {
      alert(err.message);
    }
  }

  const canVoid = user?.role === "owner" || user?.role === "manager";
  const canOverridePrice = user?.role === "owner" || user?.role === "manager";
  const salesPage = usePagination(sales, 8);

  if (completedSale) {
    return (
      <div className={styles.receiptWrap}>
        <Card className={styles.receiptCard}>
          <CheckCircle2 size={40} color="#2f9463" />
          <h2>Sale complete</h2>
          <p className={styles.receiptTotal}>{completedSale.total.toLocaleString()} {currency}</p>
          <p className={styles.muted}>{completedSale.items.length} item{completedSale.items.length === 1 ? "" : "s"} · {completedSale.paymentMethod.replace("_", " ")}</p>
          <div className={styles.receiptActions}>
            <Button variant="ghost" onClick={() => setReceiptSale(completedSale)}><Printer size={15} /> Print receipt</Button>
            <Button variant="accent" size="lg" onClick={() => setCompletedSale(null)}>New sale</Button>
          </div>
        </Card>
        {receiptSale && (
          <Receipt sale={receiptSale} storeName={store?.name || "Store"} storeLogoUrl={store?.logoUrl} currency={currency} onClose={() => setReceiptSale(null)} />
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.wrap}>
        <div className={styles.catalogPane}>
          <div className={styles.catalogToolbar}>
            <div className={styles.searchBox}>
              <Search size={16} className={styles.searchIcon} />
              <input className={styles.searchInput} placeholder="Search products to add" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <button className={styles.scanIconBtn} onClick={() => { setScanFeedback(null); setScannerOpen(true); }} title="Scan a barcode">
              <ScanBarcode size={18} />
            </button>
            <button className={styles.scanIconBtn} onClick={() => setCustomItemOpen(true)} title="Add a custom item">
              <PackagePlus size={18} />
            </button>
          </div>

          {scanFeedback && (
            <div className={styles.scanFeedback} data-type={scanFeedback.type}>
              <span>{scanFeedback.text}</span>
              {scanFeedback.type === "missing" && scanFeedback.unmatchedBarcode && (
                <button onClick={() => navigate("/app/products", { state: { prefillBarcode: scanFeedback.unmatchedBarcode } })}>
                  Add as new product →
                </button>
              )}
            </div>
          )}

          {customItemOpen && (
            <div className={styles.customItemBox}>
              <Input placeholder="Item name" value={customItemForm.name} onChange={(e) => setCustomItemForm({ ...customItemForm, name: e.target.value })} />
              <Input type="number" min="0" step="0.01" placeholder={`Price (${currency})`} value={customItemForm.unitPrice} onChange={(e) => setCustomItemForm({ ...customItemForm, unitPrice: e.target.value })} />
              <Input type="number" min="1" placeholder="Qty" value={customItemForm.quantity} onChange={(e) => setCustomItemForm({ ...customItemForm, quantity: e.target.value })} />
              <Button variant="accent" size="sm" onClick={addCustomItemToCart}>Add</Button>
              <Button variant="ghost" size="sm" onClick={() => setCustomItemOpen(false)}>Cancel</Button>
            </div>
          )}

          <div className={styles.productGrid}>
            {visibleProducts.map((p) => (
              <button key={p.clientId} className={styles.productTile} onClick={() => addToCart(p)}>
                <span className={styles.tileName}>{p.name}</span>
                <span className={styles.tilePrice}>{p.sellPrice.toLocaleString()} {currency}</span>
                <span className={styles.tileStock}>{p.quantityOnHand} {p.unit} left</span>
              </button>
            ))}
            {products.length === 0 && <p className={styles.muted}>No matching products in stock.</p>}
          </div>
          {hiddenCount > 0 && (
            <p className={styles.muted}>Showing {VISIBLE_LIMIT} of {products.length} — search by name, SKU, or scan a barcode to find the rest.</p>
          )}
        </div>

        <Card className={styles.cartPane}>
          <div className={styles.cartHeader}>
            <ShoppingCart size={17} />
            <h3>Current sale</h3>
          </div>

          {cart.length === 0 ? (
            <p className={styles.muted}>Tap a product, scan a barcode, or add a custom item.</p>
          ) : (
            <div className={styles.cartItems}>
              {cart.map((i) => {
                const isOverridden = i.unitPrice !== i.catalogPrice;
                const isEditingPrice = editingPriceKey === i.cartKey;
                return (
                  <div key={i.cartKey} className={styles.cartItem}>
                    <div className={styles.cartItemInfo}>
                      <span className={styles.cartItemName}>
                        {i.name}
                        {i.isCustom && <Badge tone="neutral">custom</Badge>}
                        {!i.isCustom && isOverridden && <Badge tone="amber">custom price</Badge>}
                      </span>
                      <span className={styles.mono}>{(i.unitPrice * i.quantity).toLocaleString()} {currency}</span>
                    </div>
                    <div className={styles.qtyControls}>
                      <button onClick={() => changeQty(i.cartKey, -1)}><Minus size={13} /></button>
                      <span>{i.quantity}</span>
                      <button onClick={() => changeQty(i.cartKey, 1)} disabled={i.quantity >= i.available}><Plus size={13} /></button>

                      {isEditingPrice ? (
                        <Input
                          autoFocus
                          type="number"
                          min="0"
                          step="0.01"
                          className={styles.priceEditInput}
                          defaultValue={i.unitPrice}
                          onBlur={(e) => {
                            updatePrice(i.cartKey, e.target.value);
                            setEditingPriceKey(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                          }}
                        />
                      ) : canOverridePrice ? (
                        <button className={styles.editPriceBtn} onClick={() => setEditingPriceKey(i.cartKey)} title="Negotiate a different price">
                          <Pencil size={12} /> {i.unitPrice.toLocaleString()}
                        </button>
                      ) : (
                        <span className={styles.editPriceBtn} title="Only an owner or manager can change the price">
                          {i.unitPrice.toLocaleString()}
                        </span>
                      )}

                      <button className={styles.removeBtn} onClick={() => removeItem(i.cartKey)}><Trash2 size={13} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className={styles.cartFooter}>
            <div className={styles.field}>
              <label>Discount ({currency})</label>
              <Input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" />
              {!discountValid && discount !== "" && (
                <p className={styles.error}>
                  {discountNum < 0 || !Number.isFinite(discountNum) ? "Discount can't be negative" : "Discount can't exceed the subtotal"}
                </p>
              )}
            </div>
            <div className={styles.field}>
              <label>Payment</label>
              <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="card">Card</option>
                <option value="credit">Credit (pay later)</option>
              </Select>
            </div>
            <div className={styles.field}>
              <label>Customer {paymentMethod === "credit" ? "(required for credit)" : "(optional)"}</label>
              <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Name" />
            </div>
            {paymentMethod === "credit" && (
              <div className={styles.field}>
                <label>Customer phone (optional)</label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Phone" />
              </div>
            )}

            <div className={styles.totalRow}>
              <span>Subtotal</span>
              <span className={styles.mono}>{subtotal.toLocaleString()} {currency}</span>
            </div>
            <div className={styles.totalRow} data-emphasis="true">
              <span>Total</span>
              <span className={styles.mono}>{total.toLocaleString()} {currency}</span>
            </div>

            {paymentMethod === "cash" && (
              <div className={styles.changeBox}>
                <div className={styles.field}>
                  <label><Calculator size={12} style={{ verticalAlign: -1, marginRight: 4 }} />Cash received ({currency})</label>
                  <Input type="number" min="0" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} placeholder="0" />
                </div>
                {change !== null && (
                  <div className={styles.changeRow} data-negative={change < 0}>
                    <span>{change < 0 ? "Still owed" : "Change due"}</span>
                    <span className={styles.mono}>{Math.abs(change).toLocaleString()} {currency}</span>
                  </div>
                )}
              </div>
            )}

            {error && <p className={styles.error}>{error}</p>}

            <Button
              variant="accent"
              size="lg"
              disabled={cart.length === 0 || charging || !discountValid || cashInsufficient || (paymentMethod === "credit" && !customerName)}
              onClick={handleCheckout}
            >
              {charging ? "Charging…" : `Charge ${total.toLocaleString()} ${currency}`}
            </Button>
          </div>
        </Card>
      </div>

      <Card className={styles.historyCard}>
        <div className={styles.historyHeader}>
          <History size={16} />
          <h3>Sales history</h3>
        </div>

        {sales.length === 0 ? (
          <p className={styles.muted}>No sales yet — they'll show up here as you make them.</p>
        ) : (
          <>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Customer</th>
                    <th>Time</th>
                    <th data-align="right">Items</th>
                    <th>Status</th>
                    <th data-align="right">Total</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {salesPage.pageItems.map((s) => {
                    const isExpanded = expandedId === s.clientId;
                    return (
                      <Fragment key={s.clientId}>
                        <tr data-clickable="true" onClick={() => setExpandedId(isExpanded ? null : s.clientId)}>
                          <td>{isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</td>
                          <td>{s.customerName || "Walk-in customer"}</td>
                          <td className="data-table-mono">{new Date(s.occurredAt).toLocaleString()}</td>
                          <td data-align="right">{s.items.length}</td>
                          <td>
                            <Badge tone={s.status === "voided" ? "danger" : s.status === "refunded" ? "amber" : "success"}>{s.status}</Badge>
                            {!s.id && <Badge tone="amber">queued</Badge>}
                          </td>
                          <td data-align="right" className="data-table-mono">{s.total.toLocaleString()} {currency}</td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <KebabMenu
                              actions={[
                                { label: "Print receipt", icon: Printer, onClick: () => setReceiptSale(s) },
                                { label: "Repeat sale", icon: RotateCcw, onClick: () => handleRepeatSale(s) },
                                {
                                  label: "Void sale",
                                  icon: Ban,
                                  tone: "danger",
                                  disabled: !canVoid || s.status !== "completed" || !s.id,
                                  disabledReason: !canVoid
                                    ? "Only owners and managers can void sales"
                                    : !s.id
                                    ? "Still syncing — try again shortly"
                                    : "Already voided or refunded",
                                  onClick: () => handleVoid(s),
                                },
                              ]}
                            />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="data-table-detail-row">
                            <td colSpan={7}>
                              <div className="data-table-detail-inner">
                                {s.items.map((item, i) => (
                                  <div key={i} className="data-table-detail-inner-row">
                                    <span>{item.name} × {item.quantity} {item.isCustom && "(custom)"}</span>
                                    <span className="data-table-mono">{item.lineTotal.toLocaleString()} {currency}</span>
                                  </div>
                                ))}
                                <div className="data-table-detail-inner-row">
                                  <span>Payment</span>
                                  <span>{s.paymentMethod.replace("_", " ")}</span>
                                </div>
                                {s.discount > 0 && (
                                  <div className="data-table-detail-inner-row">
                                    <span>Discount</span>
                                    <span>-{s.discount.toLocaleString()} {currency}</span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={salesPage.page}
              pageCount={salesPage.pageCount}
              onChange={salesPage.setPage}
              totalItems={salesPage.totalItems}
              pageSize={salesPage.pageSize}
            />
          </>
        )}
      </Card>

      {receiptSale && (
        <Receipt sale={receiptSale} storeName={store?.name || "Store"} storeLogoUrl={store?.logoUrl} currency={currency} onClose={() => setReceiptSale(null)} />
      )}

      {scannerOpen && (
        <BarcodeScanner onDetected={handleScan} onClose={() => setScannerOpen(false)} />
      )}
    </div>
  );
}