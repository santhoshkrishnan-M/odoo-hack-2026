import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs, type Page } from '../api';
import {
  BackLink, Empty, ErrorNote, Field, InvStatus, KeyValues, Loading, Modal, Money, PageHead, Pager, Panel, Picker, searchCustomers,
  SubStatus, useApi, useQueryState, useSubmit,
} from '../components';
import { addDaysIso, count, dateWords, money, PERIOD_ADJ, PERIOD_WORD, periodText, SUB_STATUS, TERMS_LABEL, todayIso, toPaise, toRupeesText } from '../format';

export interface Plan { id: number; name: string; price: number; period: string; minQuantity: number; startDate: string | null; endDate: string | null;
  autoClose: boolean; closable: boolean; pausable: boolean; renewable: boolean; taxId: number | null; taxRate?: number | null; active: boolean; activeCount?: number }
export interface Variant { id: number; attribute: string; value: string; extraPrice: number }
export interface Product { id: number; name: string; type: string; salesPrice: number; costPrice: number; taxId: number | null; active: boolean; variants: Variant[]; notes: string }
export interface Tax { id: number; name: string; rate: number; active: boolean }

interface SubRow { id: number; number: string; status: string; startDate: string; expiryDate: string | null; nextInvoiceDate: string | null;
  validUntil: string | null; customerId: number; customerName: string; planName: string; period: string; recurringAmount: number }

const TABS = ['', 'quotation', 'confirmed', 'active', 'paused', 'draft', 'closed'];

export function SubscriptionsPage() {
  const [p, set] = useQueryState();
  const page = Number(p.get('page') ?? 1);
  const status = p.get('status') ?? '';
  const { data, error, reload } = useApi<Page<SubRow>>(`/subscriptions${qs({ page, status, planId: p.get('planId'), customerId: p.get('customerId'), q: p.get('q') })}`);
  const { data: plans } = useApi<{ rows: Plan[] }>('/plans');
  const [quoting, setQuoting] = useState(false);
  const [q, setQ] = useState(p.get('q') ?? '');
  useEffect(() => { const t = setTimeout(() => { if (q !== (p.get('q') ?? '')) set({ q: q || null }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const nav = useNavigate();
  return (
    <>
      <PageHead title="Subscriptions" sub={data ? `${count(data.total)} ${status ? SUB_STATUS[status]?.label.toLowerCase() : ''} subscriptions${p.get('q') ? ` matching “${p.get('q')}”` : ''}` : ' '}
        actions={<>
          <button className="btn" onClick={() => nav('/subscriptions/new')}>New subscription</button>
          <button className="btn primary" onClick={() => setQuoting(true)}>New quotation from template</button>
        </>} />
      <section className="panel flush">
        <div style={{ padding: '4px var(--card-pad) 0' }}>
          <div className="tabs" role="tablist" aria-label="Status">
            {TABS.map((t) => <button key={t || 'all'} role="tab" aria-selected={t === status} onClick={() => set({ status: t || null })}>{t ? SUB_STATUS[t].label : 'All'}</button>)}
          </div>
        </div>
        <div className="filters" style={{ padding: '12px var(--card-pad) 0' }}>
          <input type="search" className="input" placeholder="Number or customer" aria-label="Search subscriptions" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Plan" value={p.get('planId') ?? ''} onChange={(e) => set({ planId: e.target.value || null })}>
            <option value="">All plans</option>
            {plans?.rows.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
          </select>
          {p.get('customerId') ? <button className="btn" onClick={() => set({ customerId: null })}>Clear customer filter</button> : null}
        </div>
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : data.rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty>No subscriptions match these filters.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Subscription</th><th>Customer</th><th className="hide-sm">Plan</th><th>Status</th><th className="n hide-sm">Next invoice</th><th className="n">Recurring</th><th className="n hide-sm">Started</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link className="link mono" to={`/subscriptions/${r.id}`}>{r.number}</Link></td>
                    <td className="truncate"><Link to={`/customers/${r.customerId}`}>{r.customerName}</Link></td>
                    <td className="hide-sm">{r.planName}</td>
                    <td><SubStatus status={r.status} />{r.status === 'quotation' && r.validUntil ? <span className="sub">valid until {r.validUntil}</span> : null}</td>
                    <td className="n num hide-sm">{r.status === 'active' && r.nextInvoiceDate && (!r.expiryDate || r.nextInvoiceDate < r.expiryDate) ? r.nextInvoiceDate : <span className="muted">—</span>}</td>
                    <td className="n"><Money value={r.recurringAmount} /><span className="sub">per {PERIOD_WORD[r.period]}</span></td>
                    <td className="n num hide-sm">{r.startDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => set({ page: String(n) })} /> : null}
      </section>
      {quoting ? <QuoteModal onClose={() => setQuoting(false)} /> : null}
    </>
  );
}

export function QuoteModal({ onClose, templateId }: { onClose: () => void; templateId?: number }) {
  const nav = useNavigate();
  const { data: templates } = useApi<{ rows: { id: number; name: string; planName: string; validityDays: number; lineCount: number }[] }>('/templates');
  const [tpl, setTpl] = useState<string>(templateId ? String(templateId) : '');
  const [customer, setCustomer] = useState<{ id: number; label: string; sub?: string } | null>(null);
  const [startDate, setStart] = useState(todayIso());
  const chosen = templates?.rows.find((t) => String(t.id) === tpl);
  const s = useSubmit(() => api<{ id: number }>(`/templates/${tpl}/quote`, { body: { customerId: customer?.id, startDate } }), (r) => nav(`/subscriptions/${r.id}`));
  return (
    <Modal title="New quotation from a template" onClose={onClose}>
      <form className="form" onSubmit={(e) => { if (!tpl) { e.preventDefault(); s.setError('Choose a template.'); return; } if (!customer) { e.preventDefault(); s.setError('Choose a customer.'); return; } void s.run(e); }}>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <Field label="Template" hint={chosen ? `${chosen.planName} · ${chosen.lineCount} product lines · valid for ${chosen.validityDays} days` : undefined}>
          {(id) => <select id={id} className="input" value={tpl} onChange={(e) => setTpl(e.target.value)}>
            <option value="">Choose a template</option>
            {templates?.rows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>}
        </Field>
        <Field label="Customer" error={s.fields.customerId}>{(id) => <Picker id={id} value={customer} onChange={setCustomer} search={searchCustomers} placeholder="Search by name, company or email" />}</Field>
        <Field label="Start date" error={s.fields.startDate}>{(id) => <input id={id} type="date" className="input" value={startDate} onChange={(e) => setStart(e.target.value)} />}</Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={s.busy}>Create quotation</button></div>
      </form>
    </Modal>
  );
}

/* ---------- detail ---------- */
interface SubDetail {
  id: number; number: string; status: string; customerId: number; customerName: string; customerEmail: string; planId: number; planName: string; period: string;
  planPrice: number; pausable: boolean; closable: boolean; renewable: boolean; autoClose: boolean; minQuantity: number; startDate: string; expiryDate: string | null;
  validUntil: string | null; nextInvoiceDate: string | null; paymentTermsDays: number; notes: string; templateName: string | null; createdAt: string; planTaxName: string | null;
  billing: { invoiced: number; paid: number; owed: number };
  lines: { id: number; productId: number; variantId: number | null; description: string; quantity: number; unitPrice: number; taxId: number | null; taxName: string | null; taxRate: number | null; amount: number }[];
  invoices: { id: number; number: string; status: string; invoiceDate: string; dueDate: string; periodStart: string; periodEnd: string; total: number; amountPaid: number }[];
}

const PATH = ['draft', 'quotation', 'confirmed', 'active', 'closed'];

export function StatusPath({ status }: { status: string }) {
  const at = PATH.indexOf(status === 'paused' ? 'active' : status);
  return (
    <ol className="path" aria-label="Lifecycle">
      {PATH.map((s, i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'now' : ''} aria-current={i === at ? 'step' : undefined}>
          <span className="dot" />{s === 'active' && status === 'paused' ? 'Paused' : SUB_STATUS[s].label}
        </li>
      ))}
    </ol>
  );
}

export function subscriptionActions(s: { status: string; pausable: boolean; closable: boolean; renewable: boolean; expiryDate: string | null }, portal = false) {
  const today = todayIso();
  const out: { action: string; label: string; primary?: boolean; danger?: boolean; confirm?: string }[] = [];
  const expired = !!s.expiryDate && s.expiryDate <= today;
  if (!portal && s.status === 'draft') out.push({ action: 'send', label: 'Send quotation', primary: true });
  if (s.status === 'draft' && !portal) out.push({ action: 'confirm', label: 'Confirm' });
  if (s.status === 'quotation') out.push({ action: portal ? 'accept' : 'confirm', label: portal ? 'Accept quotation' : 'Mark accepted', primary: true });
  if (!portal && s.status === 'confirmed') out.push({ action: 'activate', label: 'Activate and start billing', primary: true });
  if (s.status === 'paused') out.push({ action: 'resume', label: 'Resume', primary: true });
  if (s.status === 'active' && s.pausable) out.push({ action: 'pause', label: 'Pause' });
  const endingSoon = !!s.expiryDate && s.expiryDate <= addDaysIso(today, 90);
  if (['active', 'paused', 'closed'].includes(s.status) && s.renewable && endingSoon && (s.status !== 'closed' || expired)) out.push({ action: 'renew', label: 'Renew' });
  const running = ['confirmed', 'active', 'paused'].includes(s.status);
  if ((!portal && ['draft', 'quotation'].includes(s.status)) || (running && (s.closable || expired))) {
    out.push({ action: 'close', label: s.status === 'quotation' || s.status === 'draft' ? 'Cancel quotation' : 'Close subscription', danger: true,
      confirm: s.status === 'quotation' || s.status === 'draft' ? 'Cancel this quotation?' : 'Close this subscription? It will not be billed again.' });
  }
  if (portal && s.status === 'quotation') out.push({ action: 'close', label: 'Decline', danger: true, confirm: 'Decline this quotation?' });
  return out;
}

export function SubscriptionDetailPage() {
  const { id } = useParams();
  const { data: s, error, reload } = useApi<SubDetail>(`/subscriptions/${id}`);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!s) return <Loading />;
  const act = async (a: { action: string; label: string; confirm?: string }) => {
    if (a.confirm && !window.confirm(a.confirm)) return;
    setErr(null); setMsg(null);
    try {
      if (a.action === 'renew') { const r = await api<{ expiryDate: string }>(`/subscriptions/${s.id}/renew`, { method: 'POST' }); setMsg(`Renewed until ${dateWords(r.expiryDate)}.`); }
      else { const r = await api<{ status: string }>(`/subscriptions/${s.id}/actions/${a.action}`, { method: 'POST' }); setMsg(`Now ${SUB_STATUS[r.status].label.toLowerCase()}.`); }
      reload();
    } catch (e) { setErr((e as Error).message); }
  };
  const actions = subscriptionActions(s);
  const linesTotal = s.lines.reduce((a, l) => a + l.amount, 0);
  const recurring = s.planPrice + linesTotal;
  const billable = s.status === 'active' && s.nextInvoiceDate && (!s.expiryDate || s.nextInvoiceDate < s.expiryDate);
  return (
    <>
      <BackLink to="/subscriptions">Subscriptions</BackLink>
      <PageHead title={<span className="mono" style={{ fontSize: 'inherit', fontFamily: 'var(--font)' }}>{s.number}</span>} pill={<SubStatus status={s.status} />}
        sub={<><Link to={`/customers/${s.customerId}`} style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>{s.customerName}</Link> · {s.planName} · {money(recurring)} per {PERIOD_WORD[s.period]} before tax</>}
        actions={<>
          {['draft', 'quotation'].includes(s.status) ? <button className="btn" onClick={() => nav(`/subscriptions/${s.id}/edit`)}>Edit</button> : null}
          {actions.map((a) => <button key={a.action} className={`btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`} onClick={() => act(a)}>{a.label}</button>)}
        </>} />
      {msg ? <p className="ok-note" role="status" style={{ margin: '-8px 0 12px' }}>{msg}</p> : null}
      {err ? <div style={{ margin: '-8px 0 12px' }}><ErrorNote error={err} /></div> : null}
      <StatusPath status={s.status} />
      <div className="cols-2">
        <div className="stack">
          <Panel className="flush" title="Recurring lines" meta={`billed every ${PERIOD_WORD[s.period]}`}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th className="n">Qty</th><th className="n">Unit price</th><th className="hide-sm">Tax</th><th className="n">Amount</th></tr></thead>
                <tbody>
                  <tr><td>{s.planName}<span className="sub">plan fee</span></td><td className="n num">1</td><td className="n"><Money value={s.planPrice} /></td><td className="hide-sm">{s.planTaxName ?? <span className="muted">—</span>}</td><td className="n"><Money value={s.planPrice} /></td></tr>
                  {s.lines.map((l) => (
                    <tr key={l.id}><td>{l.description}</td><td className="n num">{count(l.quantity)}</td><td className="n"><Money value={l.unitPrice} /></td>
                      <td className="hide-sm">{l.taxName ?? <span className="muted">—</span>}</td><td className="n"><Money value={l.amount} /></td></tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={4} className="hide-sm">Recurring total before tax</td><td className="n"><Money value={recurring} strong /></td></tr></tfoot>
              </table>
            </div>
          </Panel>
          <Panel className="flush" title="Invoices" meta={billable ? `next on ${dateWords(s.nextInvoiceDate)}` : undefined}>
            {s.invoices.length === 0 ? <div style={{ padding: '0 20px 20px' }}><Empty>{s.status === 'active' ? 'The first invoice is created on the next billing run.' : 'Invoices start once the subscription is active.'}</Empty></div> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Invoice</th><th className="hide-sm">Period</th><th>Status</th><th className="n">Total</th><th className="n">Balance</th></tr></thead>
                  <tbody>
                    {s.invoices.slice(0, 12).map((i) => (
                      <tr key={i.id}>
                        <td><Link className="link mono" to={`/invoices/${i.id}`}>{i.number}</Link><span className="sub">{i.invoiceDate}</span></td>
                        <td className="hide-sm num">{periodText(i.periodStart, i.periodEnd)}</td>
                        <td><InvStatus status={i.status} overdue={i.status === 'confirmed' && i.dueDate < todayIso()} /></td>
                        <td className="n"><Money value={i.total} /></td>
                        <td className="n">{i.status === 'cancelled' ? <span className="muted">—</span> : <Money value={i.total - i.amountPaid} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {s.invoices.length > 12 ? <div className="panel-foot"><Link className="card-link" to={`/invoices?subscriptionId=${s.id}`}>All {s.invoices.length} invoices</Link></div> : null}
          </Panel>
        </div>
        <div className="stack">
        <Panel title="Billed so far" meta={s.billing.owed ? <Link className="card-link" to={`/invoices?subscriptionId=${s.id}&outstanding=1`}>Unpaid</Link> : undefined}>
          <KeyValues items={[
            ['Invoiced', <Money value={s.billing.invoiced} />],
            ['Paid', <Money value={s.billing.paid} />],
            ['Owed', s.billing.owed ? <span className="num strong">{money(s.billing.owed)}</span> : <Money value={0} />],
          ]} />
        </Panel>
        <Panel title="Details">
          <KeyValues items={[
            ['Customer', <Link to={`/customers/${s.customerId}`}>{s.customerName}</Link>],
            ['Plan', `${s.planName} (${PERIOD_ADJ[s.period].toLowerCase()})`],
            ['Starts', dateWords(s.startDate)],
            ['Ends', s.expiryDate ? dateWords(s.expiryDate) : 'Runs until closed'],
            ['Next invoice', billable ? dateWords(s.nextInvoiceDate) : '—'],
            ['Payment terms', TERMS_LABEL[s.paymentTermsDays]],
            ...(s.validUntil ? [['Quotation valid until', dateWords(s.validUntil)] as [string, string]] : []),
            ['From template', s.templateName ?? '—'],
            ['Plan rules', [s.autoClose ? 'closes at end date' : null, s.pausable ? 'can pause' : null, s.closable ? 'can close early' : 'no early close', s.renewable ? 'renewable' : 'not renewable'].filter(Boolean).join(', ')],
          ]} />
          {s.notes ? <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>{s.notes}</p> : null}
        </Panel>
        </div>
      </div>
    </>
  );
}

/* ---------- create and edit ---------- */
interface LineDraft { key: number; productId: string; variantId: string; quantity: string; unitPrice: string; taxId: string }
let lineKey = 0;
const blankLine = (): LineDraft => ({ key: ++lineKey, productId: '', variantId: '', quantity: '1', unitPrice: '', taxId: '' });

export function SubscriptionFormPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const existing = useApi<SubDetail>(id ? `/subscriptions/${id}` : null);
  const { data: plans } = useApi<{ rows: Plan[] }>('/plans');
  const { data: products } = useApi<{ rows: Product[] }>('/products');
  const { data: taxes } = useApi<{ rows: Tax[] }>('/taxes');
  const [customer, setCustomer] = useState<{ id: number; label: string; sub?: string } | null>(null);
  const [f, setF] = useState({ planId: '', startDate: todayIso(), expiryDate: '', paymentTermsDays: '15', notes: '' });
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [loaded, setLoaded] = useState(!id);
  const [search] = useSearchParams();
  useEffect(() => {
    const cid = search.get('customerId');
    if (id || !cid) return;
    api<{ id: number; name: string; email: string; company: string }>(`/customers/${cid}`).then((c) => setCustomer({ id: c.id, label: c.name, sub: c.company || c.email })).catch(() => undefined);
  }, [id, search]);

  useEffect(() => {
    const s = existing.data;
    if (!s || loaded) return;
    setCustomer({ id: s.customerId, label: s.customerName, sub: s.customerEmail });
    setF({ planId: String(s.planId), startDate: s.startDate, expiryDate: s.expiryDate ?? '', paymentTermsDays: String(s.paymentTermsDays), notes: s.notes });
    setLines(s.lines.map((l) => ({ key: ++lineKey, productId: String(l.productId), variantId: l.variantId ? String(l.variantId) : '', quantity: String(l.quantity), unitPrice: toRupeesText(l.unitPrice), taxId: l.taxId ? String(l.taxId) : '' })));
    setLoaded(true);
  }, [existing.data, loaded]);

  const plan = plans?.rows.find((p) => String(p.id) === f.planId);
  const product = (pid: string) => products?.rows.find((p) => String(p.id) === pid);
  const defaultPrice = (l: LineDraft) => {
    const p = product(l.productId);
    if (!p) return 0;
    return p.salesPrice + (p.variants.find((v) => String(v.id) === l.variantId)?.extraPrice ?? 0);
  };
  const unit = (l: LineDraft) => (l.unitPrice !== '' ? toPaise(l.unitPrice) : defaultPrice(l));
  const rate = (taxId: string | number | null | undefined) => taxes?.rows.find((t) => String(t.id) === String(taxId))?.rate ?? 0;
  const lineTax = (l: LineDraft) => rate(l.taxId || product(l.productId)?.taxId);
  const totals = useMemo(() => {
    const planFee = plan?.price ?? 0;
    const sub = planFee + lines.reduce((a, l) => a + unit(l) * (Number(l.quantity) || 0), 0);
    const tax = Math.round(planFee * rate(plan?.taxId) / 100) + lines.reduce((a, l) => a + Math.round(unit(l) * (Number(l.quantity) || 0) * lineTax(l) / 100), 0);
    return { sub, tax };
  }, [lines, plan, products, taxes]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => ({
    customerId: customer?.id ?? 0, planId: Number(f.planId) || 0, startDate: f.startDate, expiryDate: f.expiryDate || null,
    paymentTermsDays: Number(f.paymentTermsDays), notes: f.notes,
    lines: lines.filter((l) => l.productId).map((l) => ({ productId: Number(l.productId), variantId: l.variantId ? Number(l.variantId) : null,
      quantity: Number(l.quantity) || 0, unitPrice: l.unitPrice !== '' ? toPaise(l.unitPrice) : null, taxId: l.taxId ? Number(l.taxId) : undefined })),
  });
  const s = useSubmit(async () => {
    if (id) { await api(`/subscriptions/${id}`, { method: 'PUT', body: body() }); return { id: Number(id) }; }
    return api<{ id: number }>('/subscriptions', { body: body() });
  }, (r) => nav(`/subscriptions/${r.id}`));
  const upd = (key: number, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const today = todayIso();
  const availablePlans = plans?.rows.filter((p) => (p.active && (!p.endDate || p.endDate >= today)) || String(p.id) === f.planId) ?? [];

  if (id && !loaded) return <Loading />;
  return (
    <>
      <BackLink to={id ? `/subscriptions/${id}` : '/subscriptions'}>{id ? 'Back to subscription' : 'Subscriptions'}</BackLink>
      <PageHead title={id ? `Edit ${existing.data?.number ?? ''}` : 'New subscription'} sub="Saved as a draft. Send it as a quotation, or confirm it straight away." />
      <form className="cols-2" onSubmit={s.run} noValidate>
        <div className="stack">
          {s.error ? <ErrorNote error={s.error} /> : null}
          <Panel title="Customer and plan">
            <div className="form-grid">
              <Field label="Customer" error={s.fields.customerId} wide>{(fid) => <Picker id={fid} value={customer} onChange={setCustomer} search={searchCustomers} placeholder="Search by name, company or email" />}</Field>
              <Field label="Plan" error={s.fields.planId} hint={plan ? `${money(plan.price)} per ${PERIOD_WORD[plan.period]} · at least ${plan.minQuantity} on each line` : undefined}>
                {(fid) => <select id={fid} className="input" value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
                  <option value="">Choose a plan</option>
                  {availablePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>}
              </Field>
              <Field label="Payment terms">{(fid) => <select id={fid} className="input" value={f.paymentTermsDays} onChange={(e) => setF({ ...f, paymentTermsDays: e.target.value })}>
                {Object.entries(TERMS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
              <Field label="Start date" error={s.fields.startDate}>{(fid) => <input id={fid} type="date" className="input" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />}</Field>
              <Field label="End date" error={s.fields.expiryDate} hint="Leave empty to run until closed">{(fid) => <input id={fid} type="date" className="input" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} />}</Field>
              <Field label="Notes" wide>{(fid) => <textarea id={fid} className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field>
            </div>
          </Panel>
          <Panel className="flush" title="Product lines" meta={plan ? `prices per ${PERIOD_WORD[plan.period]}` : undefined}>
            <div className="table-wrap">
              <table className="lines-table">
                <thead><tr><th>Product</th><th>Variant</th><th className="n">Qty</th><th className="n">Unit price, ₹</th><th>Tax</th><th className="n">Amount</th><th><span className="sr-only">Remove</span></th></tr></thead>
                <tbody>
                  {lines.map((l) => {
                    const p = product(l.productId);
                    return (
                      <tr key={l.key}>
                        <td><select className="input" aria-label="Product" value={l.productId} onChange={(e) => upd(l.key, { productId: e.target.value, variantId: '', unitPrice: '', taxId: '' })}>
                          <option value="">Choose</option>
                          {products?.rows.filter((x) => x.active || String(x.id) === l.productId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select></td>
                        <td>{p && p.variants.length ? <select className="input" aria-label="Variant" value={l.variantId} onChange={(e) => upd(l.key, { variantId: e.target.value, unitPrice: '' })}>
                          <option value="">Standard</option>
                          {p.variants.map((v) => <option key={v.id} value={v.id}>{v.attribute}: {v.value}{v.extraPrice ? ` (+${money(v.extraPrice)})` : ''}</option>)}
                        </select> : <span className="muted">—</span>}</td>
                        <td className="qty"><input className="input num" style={{ textAlign: 'right' }} aria-label="Quantity" inputMode="numeric" value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value.replace(/\D/g, '') })} /></td>
                        <td className="price"><input className="input num" style={{ textAlign: 'right' }} aria-label="Unit price in rupees" inputMode="decimal" placeholder={toRupeesText(defaultPrice(l))} value={l.unitPrice} onChange={(e) => upd(l.key, { unitPrice: e.target.value })} /></td>
                        <td><select className="input" aria-label="Tax" value={l.taxId || (p?.taxId ? String(p.taxId) : '')} onChange={(e) => upd(l.key, { taxId: e.target.value })}>
                          <option value="">No tax</option>
                          {taxes?.rows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select></td>
                        <td className="n"><Money value={unit(l) * (Number(l.quantity) || 0)} /></td>
                        <td><button type="button" className="btn ghost" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="panel-foot"><button type="button" className="btn" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add a line</button>
              {s.fields.lines ? <span className="field-error" style={{ marginLeft: 12 }}>{s.fields.lines.join(' ')}</span> : null}</div>
          </Panel>
        </div>
        <Panel title="Each invoice" className="sticky-rail">
          <KeyValues items={[
            ['Plan fee', <Money value={plan?.price ?? 0} />],
            ['Product lines', <Money value={totals.sub - (plan?.price ?? 0)} />],
            ['Tax', <Money value={totals.tax} />],
            ['Total per ' + (plan ? PERIOD_WORD[plan.period] : 'period'), <Money value={totals.sub + totals.tax} strong />],
          ]} />
          <p className="muted" style={{ fontSize: 12, margin: '12px 0 16px' }}>Discount rules the admin has set are applied automatically when each invoice is created.</p>
          <div className="form-actions" style={{ justifyContent: 'stretch' }}><button className="btn primary" style={{ flex: 1 }} disabled={s.busy}>{id ? 'Save changes' : 'Save draft'}</button></div>
        </Panel>
      </form>
    </>
  );
}
