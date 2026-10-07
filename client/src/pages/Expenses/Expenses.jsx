import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Pencil, Trash2, X, Download, Repeat, Paperclip } from "lucide-react";
import { Card, Button, Field, Input, Select, TextArea, Badge, EmptyState } from "../../components/ui/ui.jsx";
import CategorySelect from "../../components/CategorySelect/CategorySelect.jsx";
import PhotoDropzone from "../../components/PhotoDropzone/PhotoDropzone.jsx";
import PeriodNav from "../../components/PeriodNav/PeriodNav.jsx";
import Pagination from "../../components/Pagination/Pagination.jsx";
import { usePeriodNavigator } from "../../hooks/usePeriodNavigator.js";
import { usePagination } from "../../hooks/usePagination.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import {
  listExpenses,
  listExpenseCategories,
  createExpense,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  listDueRecurringExpenses,
  logRecurringExpenses,
  listSuppliers,
} from "../../lib/repo.js";
import { api } from "../../lib/api.js";
import { downloadCsv } from "../../lib/csv.js";
import { isoToDateInput, todayDateInput } from "../../lib/dates.js";
import { EXPENSE_PAYMENT_METHODS, EXPENSE_FREQUENCIES, PAYMENT_METHOD_LABELS, FREQUENCY_LABELS } from "../../lib/expenseMeta.js";
import { useAuth } from "../../context/AuthContext.jsx";
import styles from "./Expenses.module.css";

const emptyForm = () => ({
  amount: "", date: todayDateInput(), category: "", description: "", paymentMethod: "cash",
  supplierId: "", isRecurring: false, frequency: "monthly", receiptUrl: "",
});

/** Local day boundaries from the two date inputs; `to` becomes EXCLUSIVE (next midnight) so the picked end day is included. */
function dayRange(fromStr, toStr) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const from = parse(fromStr);
  const toDay = parse(toStr);
  return { from, to: toDay ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate() + 1) : null };
}

export default function Expenses() {
  const { store, user } = useAuth();
  const canView = user?.role === "owner" || user?.role === "manager"; // see + add
  const canEdit = user?.role === "owner"; // edit + delete (matches server)
  const currency = store?.currency || "RWF";
  const isMobile = useIsMobile();
  const nav = usePeriodNavigator("month");

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ total: 0, count: 0, byCategory: [], change: null });
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [dueCount, setDueCount] = useState(0);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [receiptFile, setReceiptFile] = useState(null);
  const [receiptPreview, setReceiptPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [dueOpen, setDueOpen] = useState(false);
  const [dueRows, setDueRows] = useState([]); // [{ seriesId, template, periodLabel, amount }]
  const [dueError, setDueError] = useState("");
  const [dueSaving, setDueSaving] = useState(false);

  useEffect(() => {
    if (!receiptFile) {
      setReceiptPreview(null);
      return;
    }
    const url = URL.createObjectURL(receiptFile);
    setReceiptPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [receiptFile]);

  async function load() {
    const { from, to } = dayRange(fromDate, toDate);
    const [list, sum, cats, due] = await Promise.all([
      listExpenses({ search, category, from, to }),
      getExpenseSummary(nav.period, nav.offset),
      listExpenseCategories(),
      listDueRecurringExpenses(),
    ]);
    setItems(list);
    setSummary(sum);
    setCategories(cats);
    setDueCount(due.length);
  }

  useEffect(() => {
    if (!canView) return;
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, search, category, fromDate, toDate, nav.period, nav.offset]);

  useEffect(() => {
    if (canView) listSuppliers().then(setSuppliers);
  }, [canView]);

  const { page, setPage, pageCount, pageItems, totalItems, pageSize } = usePagination(items, 12);
  const filteredTotal = useMemo(() => items.reduce((n, e) => n + (Number(e.amount) || 0), 0), [items]);

  if (!canView) {
    return (
      <Card className={styles.denied}>
        <EmptyState title="Expenses are for owners and managers" description="Ask the store owner if you need access." />
      </Card>
    );
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setReceiptFile(null);
    setError("");
    setModalOpen(true);
  }

  function openEdit(e) {
    if (!canEdit) return;
    setEditingId(e.clientId);
    setForm({
      amount: e.amount ?? "", date: isoToDateInput(e.date), category: e.category || "", description: e.description || "",
      paymentMethod: e.paymentMethod || "cash", supplierId: e.supplierId || "", isRecurring: !!e.isRecurring,
      frequency: e.frequency || "monthly", receiptUrl: e.receiptUrl || "",
    });
    setReceiptFile(null);
    setError("");
    setModalOpen(true);
  }

  async function handleSave(ev) {
    ev.preventDefault();
    setError("");
    setSaving(true);
    try {
      let receiptUrl = form.receiptUrl;
      if (receiptFile) {
        if (!navigator.onLine) {
          // Never pretend the receipt saved: the expense still saves, the photo doesn't.
          setError("Receipt photos need a connection — the expense was saved WITHOUT its receipt. Edit it later to attach one.");
        } else {
          const fd = new FormData();
          fd.append("image", receiptFile);
          const { data } = await api.post("/sync/upload-queued-image?folder=receipts", fd, { headers: { "Content-Type": "multipart/form-data" } });
          receiptUrl = data.imageUrl;
        }
      }
      const payload = { ...form, receiptUrl };
      if (editingId) await updateExpense(editingId, payload);
      else await createExpense(payload);
      // Keep the modal open if we have a warning to show (offline receipt), otherwise close.
      if (!(receiptFile && !navigator.onLine)) setModalOpen(false);
      load();
    } catch (err) {
      setError(err.message || "Couldn't save the expense");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(e) {
    if (!canEdit) return;
    if (!confirm(`Delete this ${Number(e.amount).toLocaleString()} ${currency} expense${e.category ? ` (${e.category})` : ""}?`)) return;
    try {
      await deleteExpense(e.clientId);
      load();
    } catch (err) {
      alert(err.message || "Couldn't delete the expense");
    }
  }

  function handleExport() {
    downloadCsv(
      "expenses.csv",
      items.map((e) => ({
        date: isoToDateInput(e.date),
        category: e.category || "",
        description: e.description || "",
        amount: e.amount,
        paymentMethod: PAYMENT_METHOD_LABELS[e.paymentMethod] || e.paymentMethod,
        supplier: e.supplierName || "",
        recurring: e.isRecurring ? FREQUENCY_LABELS[e.frequency] || "yes" : "",
        receipt: e.receiptUrl || "",
      }))
    );
  }

  async function openDue() {
    setDueError("");
    const due = await listDueRecurringExpenses();
    setDueRows(due.map((d) => ({ ...d, amount: String(d.template.amount) })));
    setDueOpen(true);
  }

  async function confirmDue() {
    setDueError("");
    setDueSaving(true);
    try {
      const result = await logRecurringExpenses(dueRows.map((r) => ({ seriesId: r.seriesId, amount: r.amount })));
      if (result.skipped > 0) {
        setDueError(`${result.created} logged. ${result.skipped} were already logged for this period and were skipped.`);
        setDueRows([]);
      } else {
        setDueOpen(false);
      }
      load();
    } catch (err) {
      setDueError(err.message || "Couldn't log the recurring expenses");
    } finally {
      setDueSaving(false);
    }
  }

  const maxCat = summary.byCategory[0]?.total || 1;
  const supplierOptions = suppliers.filter((s) => !s.isDeleted);

  return (
    <div>
      <div className={styles.header}>
        <div>
          <h1>Expenses</h1>
          <p className={styles.sub}>{items.length} shown · {filteredTotal.toLocaleString()} {currency}</p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="ghost" onClick={handleExport} disabled={items.length === 0}>
            <Download size={16} /> Export CSV
          </Button>
          <Button variant="ghost" onClick={openDue} disabled={dueCount === 0} title={dueCount === 0 ? "Nothing recurring is due this period" : ""}>
            <Repeat size={16} /> Log recurring{dueCount > 0 ? ` (${dueCount})` : ""}
          </Button>
          <Button variant="accent" onClick={openCreate}>
            <Plus size={16} /> Add expense
          </Button>
        </div>
      </div>

      <Card className={styles.summary}>
        <div className={styles.summaryTop}>
          <span className={styles.summaryTitle}>Total expenses</span>
          <PeriodNav rangeLabel={nav.rangeLabel} period={nav.period} onPeriodChange={nav.setPeriod} onBack={nav.goBack} onForward={nav.goForward} canGoForward={nav.canGoForward} />
        </div>
        <div className={styles.total}>{summary.total.toLocaleString()} {currency}</div>
        <div className={styles.change} data-tone={summary.change === null || summary.change === 0 ? "neutral" : summary.change > 0 ? "up" : "down"}>
          {summary.count} expense{summary.count === 1 ? "" : "s"}
          {summary.change !== null && summary.change !== 0 && ` · ${Math.abs(summary.change)}% ${summary.change > 0 ? "more" : "less"} than the previous period`}
        </div>
        {summary.byCategory.length > 0 && (
          <div className={styles.cats}>
            {summary.byCategory.map((c) => (
              <div key={c.category} className={styles.cat}>
                <div className={styles.catName}>{c.category} · {c.count}</div>
                <div className={styles.catTotal}>{c.total.toLocaleString()} {currency}</div>
                <div className={styles.catBar}><i style={{ width: `${Math.max(4, (c.total / maxCat) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input className={styles.searchInput} placeholder="Search description, category or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className={styles.filterSelect} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          <option value="__none__">Uncategorized</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input type="date" className={styles.dateInput} value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} aria-label="From date" />
        <input type="date" className={styles.dateInput} value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} aria-label="To date" />
        {(search || category || fromDate || toDate) && (
          <button className={styles.selectionClearBtn} onClick={() => { setSearch(""); setCategory(""); setFromDate(""); setToDate(""); }}>Clear filters</button>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            title={search || category || fromDate || toDate ? "No expenses match these filters" : "No expenses yet"}
            description="Record rent, wages, transport and other costs so your profit & loss is complete."
            action={<Button variant="accent" onClick={openCreate}><Plus size={16} /> Add expense</Button>}
          />
        </Card>
      ) : isMobile ? (
        pageItems.map((e) => (
          <Card key={e.clientId} className={styles.expenseCard}>
            <div className={styles.expenseCardMain}>
              <div className={styles.productName}>{e.category || "Uncategorized"} {e.isRecurring && <Badge tone="neutral">{FREQUENCY_LABELS[e.frequency]}</Badge>} {e.dirty === 1 && <Badge tone="amber">queued</Badge>}</div>
              <div className={styles.productMeta}>{isoToDateInput(e.date)} · {e.description || "—"}</div>
            </div>
            <div className={styles.expenseAmount}>{Number(e.amount).toLocaleString()} {currency}</div>
            {canEdit && (
              <div className={styles.actions}>
                <button className={styles.iconBtn} onClick={() => openEdit(e)} title="Edit"><Pencil size={15} /></button>
                <button className={styles.iconBtn} onClick={() => handleDelete(e)} title="Delete"><Trash2 size={15} /></button>
              </div>
            )}
          </Card>
        ))
      ) : (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th><th>Category</th><th>Description</th><th>Supplier</th><th>Paid by</th>
                <th data-align="right">Amount</th><th>Receipt</th>{canEdit && <th />}
              </tr>
            </thead>
            <tbody>
              {pageItems.map((e) => (
                <tr key={e.clientId}>
                  <td className="data-table-mono">{isoToDateInput(e.date)}</td>
                  <td>
                    {e.category || "—"} {e.isRecurring && <Badge tone="neutral">{FREQUENCY_LABELS[e.frequency]}</Badge>} {e.dirty === 1 && <Badge tone="amber">queued</Badge>}
                  </td>
                  <td>{e.description || "—"}</td>
                  <td>{e.supplierName || "—"}</td>
                  <td>{PAYMENT_METHOD_LABELS[e.paymentMethod] || e.paymentMethod}</td>
                  <td data-align="right" className="data-table-mono">{Number(e.amount).toLocaleString()} {currency}</td>
                  <td>{e.receiptUrl ? <a className={styles.receiptLink} href={e.receiptUrl} target="_blank" rel="noreferrer"><Paperclip size={13} /> View</a> : "—"}</td>
                  {canEdit && (
                    <td>
                      <div className={styles.actions}>
                        <button className={styles.iconBtn} onClick={() => openEdit(e)} title="Edit"><Pencil size={15} /></button>
                        <button className={styles.iconBtn} onClick={() => handleDelete(e)} title="Delete"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={page} pageCount={pageCount} onChange={setPage} totalItems={totalItems} pageSize={pageSize} />

      {modalOpen && (
        <div className={styles.overlay} onClick={() => setModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingId ? "Edit expense" : "Add expense"}</h2>
              <button className={styles.iconBtn} onClick={() => setModalOpen(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className={styles.form}>
              <div className={styles.row2}>
                <Field label={`Amount (${currency})`}><Input type="number" min="0" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
                <Field label="Date"><Input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
              </div>
              <div className={styles.row2}>
                <Field label="Category">
                  <CategorySelect value={form.category} onChange={(val) => setForm({ ...form, category: val })} loadCategories={listExpenseCategories} />
                </Field>
                <Field label="Paid by">
                  <Select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                    {EXPENSE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Supplier (optional)">
                <Select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                  <option value="">None</option>
                  {supplierOptions.map((s) => <option key={s.clientId} value={s.id || s.clientId}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Description"><TextArea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. October shop rent" /></Field>
              <Field label="Receipt photo (optional)">
                <PhotoDropzone previewSrc={receiptPreview || form.receiptUrl || null} onFileSelected={setReceiptFile} />
              </Field>

              <label className={styles.checkboxLabel}>
                <input type="checkbox" checked={form.isRecurring} onChange={(e) => setForm({ ...form, isRecurring: e.target.checked })} />
                Recurring expense (rent, salaries…)
              </label>
              {form.isRecurring && (
                <>
                  <Field label="Repeats">
                    <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                      {EXPENSE_FREQUENCIES.map((f) => <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>)}
                    </Select>
                  </Field>
                  <p className={styles.note}>Nothing is created automatically. Each {form.frequency === "weekly" ? "week" : "month"} use “Log recurring” to review the amount and add it.</p>
                </>
              )}

              {error && <p className={styles.error}>{error}</p>}

              <div className={styles.modalActions}>
                <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>{error && !saving ? "Close" : "Cancel"}</Button>
                <Button type="submit" variant="accent" disabled={saving}>{saving ? "Saving…" : "Save expense"}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dueOpen && (
        <div className={styles.overlay} onClick={() => setDueOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Log recurring expenses</h2>
              <button className={styles.iconBtn} onClick={() => setDueOpen(false)}><X size={18} /></button>
            </div>
            <div className={styles.form}>
              {dueRows.length === 0 ? (
                <p className={styles.note}>{dueError || "Nothing recurring is due right now."}</p>
              ) : (
                <>
                  <p className={styles.note}>Review each amount — rent or wages may have changed. These are dated today.</p>
                  <ul className={styles.dueList}>
                    {dueRows.map((r, i) => (
                      <li key={r.seriesId} className={styles.dueItem}>
                        <div>
                          <div className={styles.dueName}>{r.template.category || "Uncategorized"}{r.template.description ? ` — ${r.template.description}` : ""}</div>
                          <div className={styles.dueMeta}>{FREQUENCY_LABELS[r.frequency]} · {r.periodLabel}</div>
                        </div>
                        <Input type="number" min="0" step="0.01" value={r.amount} aria-label="Amount" onChange={(e) => setDueRows(dueRows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                      </li>
                    ))}
                  </ul>
                  {dueError && <p className={styles.error}>{dueError}</p>}
                  <div className={styles.modalActions}>
                    <Button type="button" variant="ghost" onClick={() => setDueOpen(false)}>Cancel</Button>
                    <Button type="button" variant="accent" disabled={dueSaving} onClick={confirmDue}>{dueSaving ? "Logging…" : `Log ${dueRows.length} expense${dueRows.length === 1 ? "" : "s"}`}</Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}