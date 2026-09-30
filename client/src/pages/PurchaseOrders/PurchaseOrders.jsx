import { useEffect, useState, Fragment } from "react";
import {
  Plus, X, ChevronDown, ChevronUp, PackageCheck,
  TrendingDown, Trash2,
} from "lucide-react";
import { Card, Button, Field, Input, Select, Badge, EmptyState } from "../../components/ui/ui.jsx";
import {
  listPurchaseOrders, createPurchaseOrder, receivePurchaseOrder, updatePurchaseOrderStatus,
  listSuppliers, listProducts, getReorderSuggestions,
} from "../../lib/repo.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./PurchaseOrders.module.css";

const STATUS_TONE = {
  draft: "neutral",
  ordered: "amber",
  partially_received: "amber",
  received: "success",
  cancelled: "danger",
};

const STATUS_LABEL = {
  draft: "Draft",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
};

export default function PurchaseOrders() {
  const { store, user } = useAuth();
  const canEdit = user?.role === "owner" || user?.role === "manager";

  const [orders, setOrders] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [expandedId, setExpandedId] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [lineItems, setLineItems] = useState([]); // { productId, name, quantityOrdered, unitCost }
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const [receiveTarget, setReceiveTarget] = useState(null); // order being received against
  const [receiveQuantities, setReceiveQuantities] = useState({});

  async function load() {
    const [po, sup, prod, sugg] = await Promise.all([
      listPurchaseOrders(), listSuppliers(), listProducts(), getReorderSuggestions(),
    ]);
    setOrders(po);
    setSuppliers(sup);
    setProducts(prod);
    setSuggestions(sugg);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const currency = store?.currency || "RWF";

  function openCreate(prefillItems = []) {
    setSupplierId("");
    setSupplierName("");
    setLineItems(prefillItems);
    setNotes("");
    setError("");
    setCreateOpen(true);
  }

  function addLineItem() {
    setLineItems((items) => [...items, { productId: "", name: "", quantityOrdered: "", unitCost: "" }]);
  }

  function updateLineItem(index, changes) {
    setLineItems((items) => items.map((it, i) => (i === index ? { ...it, ...changes } : it)));
  }

  function removeLineItem(index) {
    setLineItems((items) => items.filter((_, i) => i !== index));
  }

  function handleSupplierSelect(clientId) {
    setSupplierId(clientId);
    const supplier = suppliers.find((s) => s.clientId === clientId);
    setSupplierName(supplier?.name || "");
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError("");
    const validItems = lineItems.filter((i) => i.productId && Number(i.quantityOrdered) > 0);
    if (validItems.length === 0) return setError("Add at least one product with a quantity");

    setSaving(true);
    try {
      await createPurchaseOrder({
        supplierId: supplierId || null,
        supplierName,
        items: validItems.map((i) => ({ productId: i.productId, quantityOrdered: i.quantityOrdered, unitCost: i.unitCost })),
        notes,
      });
      setCreateOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function openReceive(order) {
    setError("");
    const initial = {};
    for (const item of order.items) {
      const remaining = item.quantityOrdered - item.quantityReceived;
      if (remaining > 0) initial[item.productId] = remaining;
    }
    setReceiveQuantities(initial);
    setReceiveTarget(order);
  }

  async function handleReceive(e) {
    e.preventDefault();
    setError("");
    const items = Object.entries(receiveQuantities)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([productId, qty]) => ({ productId, quantityReceived: Number(qty) }));
    if (items.length === 0) return setReceiveTarget(null);

    setReceiving(true);
    try {
      await receivePurchaseOrder(receiveTarget.clientId, items);
      setReceiveTarget(null);
      load();
    } catch (err) {
      // Previously this had no try/catch at all: a failure here (of any
      // kind) just left the modal open with zero visible feedback — the
      // "Confirm receipt" button looked like it silently did nothing.
      setError(err.message);
    } finally {
      setReceiving(false);
    }
  }

  async function handleCancel(order) {
    if (!confirm("Cancel this purchase order?")) return;
    await updatePurchaseOrderStatus(order.clientId, "cancelled");
    load();
  }

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Purchase Orders</h1>
          <p className={styles.sub}>Orders placed with suppliers, and what's likely to run out soon.</p>
        </div>
        {canEdit && (
          <Button variant="accent" onClick={() => openCreate()}>
            <Plus size={16} /> New order
          </Button>
        )}
      </div>

      {suggestions.length > 0 && (
        <Card className={styles.suggestionsCard}>
          <div className={styles.cardHeader}>
            <TrendingDown size={16} />
            <h3>Likely to run out soon</h3>
          </div>
          <div className={styles.suggestionsList}>
            {suggestions.slice(0, 8).map((s) => (
              <div key={s.product.clientId} className={styles.suggestionRow}>
                <div className={styles.suggestionInfo}>
                  <span className={styles.suggestionName}>{s.product.name}</span>
                  <span className={styles.suggestionMeta}>
                    {s.product.quantityOnHand} on hand
                    {s.daysOfStockLeft !== null && ` · ~${s.daysOfStockLeft} day${s.daysOfStockLeft === 1 ? "" : "s"} of stock left`}
                  </span>
                </div>
                <span className={styles.suggestionQty}>Suggest: {s.suggestedQuantity}</span>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      openCreate([{ productId: s.product.clientId, name: s.product.name, quantityOrdered: s.suggestedQuantity, unitCost: s.product.costPrice || "" }])
                    }
                  >
                    Order
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {orders.length === 0 ? (
        <Card>
          <EmptyState
            title="No purchase orders yet"
            description="Create one when you're ready to reorder stock from a supplier."
            action={canEdit ? <Button variant="accent" onClick={() => openCreate()}><Plus size={16} /> New order</Button> : undefined}
          />
        </Card>
      ) : (
        <Card>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th data-align="right">Items</th>
                  <th data-align="right">Placed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const isExpanded = expandedId === order.clientId;
                  const canReceive = canEdit && ["ordered", "partially_received"].includes(order.status);
                  return (
                    <Fragment key={order.clientId}>
                      <tr data-clickable="true" onClick={() => setExpandedId(isExpanded ? null : order.clientId)}>
                        <td>{isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</td>
                        <td>{order.supplierName || "No supplier"}</td>
                        <td><Badge tone={STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Badge> {!order.id && <Badge tone="amber">queued</Badge>}</td>
                        <td data-align="right">{order.items.length}</td>
                        <td data-align="right" className="data-table-mono">{order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "—"}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className={styles.rowActions}>
                            {canReceive && (
                              <Button variant="ghost" size="sm" onClick={() => openReceive(order)}>
                                <PackageCheck size={14} /> Receive
                              </Button>
                            )}
                            {canEdit && order.status !== "received" && order.status !== "cancelled" && (
                              <button className={styles.cancelBtn} onClick={() => handleCancel(order)} title="Cancel order">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="data-table-detail-row">
                          <td colSpan={6}>
                            <div className="data-table-detail-inner">
                              {order.items.map((item, i) => (
                                <div key={i} className="data-table-detail-inner-row">
                                  <span>{item.name} — {item.quantityReceived}/{item.quantityOrdered} received</span>
                                  <span className="data-table-mono">{item.unitCost ? `${item.unitCost.toLocaleString()} ${currency} each` : ""}</span>
                                </div>
                              ))}
                              {order.notes && (
                                <div className="data-table-detail-inner-row">
                                  <span>Notes</span>
                                  <span>{order.notes}</span>
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
        </Card>
      )}

      {createOpen && (
        <div className={styles.overlay} onClick={() => setCreateOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>New purchase order</h2>
              <button className={styles.iconBtn} onClick={() => setCreateOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleCreate} className={styles.form}>
              <div className={styles.row2}>
                <Field label="Supplier">
                  <Select value={supplierId} onChange={(e) => handleSupplierSelect(e.target.value)}>
                    <option value="">Select a supplier…</option>
                    {suppliers.map((s) => <option key={s.clientId} value={s.clientId}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field label="Or type a supplier name" hint="If not in your list yet">
                  <Input value={supplierName} onChange={(e) => { setSupplierName(e.target.value); setSupplierId(""); }} />
                </Field>
              </div>

              <Field label="Items">
                <div className={styles.itemsList}>
                  {lineItems.map((item, i) => (
                    <div key={i} className={styles.itemRow}>
                      <Select
                        value={item.productId}
                        onChange={(e) => {
                          const product = products.find((p) => p.clientId === e.target.value);
                          updateLineItem(i, { productId: e.target.value, name: product?.name || "" });
                        }}
                      >
                        <option value="">Select product…</option>
                        {products.map((p) => <option key={p.clientId} value={p.clientId}>{p.name}</option>)}
                      </Select>
                      <Input type="number" min="1" placeholder="Qty" value={item.quantityOrdered} onChange={(e) => updateLineItem(i, { quantityOrdered: e.target.value })} />
                      <Input type="number" min="0" step="0.01" placeholder="Unit cost" value={item.unitCost} onChange={(e) => updateLineItem(i, { unitCost: e.target.value })} />
                      <button type="button" className={styles.removeItemBtn} onClick={() => removeLineItem(i)}><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={addLineItem}><Plus size={14} /> Add item</Button>
                </div>
              </Field>

              <Field label="Notes (optional)">
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>

              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.modalActions}>
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={saving}>{saving ? "Creating…" : "Create order"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {receiveTarget && (
        <div className={styles.overlay} onClick={() => setReceiveTarget(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Receive stock</h2>
              <button className={styles.iconBtn} onClick={() => setReceiveTarget(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleReceive} className={styles.form}>
              {receiveTarget.items
                .filter((item) => item.quantityReceived < item.quantityOrdered)
                .map((item) => (
                  <Field key={item.productId} label={`${item.name} (${item.quantityReceived}/${item.quantityOrdered} received)`}>
                    <Input
                      type="number"
                      min="0"
                      max={item.quantityOrdered - item.quantityReceived}
                      value={receiveQuantities[item.productId] ?? ""}
                      onChange={(e) => setReceiveQuantities({ ...receiveQuantities, [item.productId]: e.target.value })}
                    />
                  </Field>
                ))}
              <div className={styles.modalActions}>
                <Button type="button" variant="ghost" onClick={() => setReceiveTarget(null)}>Cancel</Button>
                <Button type="submit" variant="accent" disabled={receiving}>{receiving ? "Confirming…" : "Confirm receipt"}</Button>
              </div>
              {error && <p className={styles.error}>{error}</p>}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
