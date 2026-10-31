import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, qs, type Page } from '../api';
import { ActivityList, BackLink, Empty, ErrorNote, ExportLink, Field, InvStatus, KeyValues, Loading, Modal, Money, PageHead, Pager, Panel, useApi, useQueryState, useSubmit, type ActivityRow } from '../components';
import { count, dateWords, METHOD_LABEL, money, periodText, periodWords, todayIso, toPaise, toRupeesText } from '../format';
import { Mark } from '../icons';

interface InvRow { id: number; number: string; kind: string; reminderCount: number; status: string; invoiceDate: string; dueDate: string; periodStart: string; periodEnd: string; total: number;
  amountPaid: number; balance: number; sentAt: string | null; customerId: number; customerName: string; subscriptionNumber: string; overdue: number }

const TABS: [string, string, Record<string, string | null>][] = [
  ['all', 'All', { status: null, overdue: null, outstanding: null, kind: null }],
  ['draft', 'Draft', { status: 'draft', overdue: null, outstanding: null, kind: null }],
  ['open', 'Awaiting payment', { status: null, overdue: null, outstanding: '1', kind: null }],
  ['overdue', 'Overdue', { status: null, overdue: '1', outstanding: null, kind: null }],
  ['paid', 'Paid', { status: 'paid', overdue: null, outstanding: null, kind: null }],
  ['credit_note', 'Credit notes', { status: null, overdue: null, outstanding: null, kind: 'credit_note' }],
  ['cancelled', 'Cancelled', { status: 'cancelled', overdue: null, outstanding: null, kind: null }],
];

export function InvoicesPage() {
  const [p, set] = useQueryState();
  const page = Number(p.get('page') ?? 1);
  const tab = p.get('kind') === 'credit_note' ? 'credit_note' : p.get('overdue') ? 'overdue' : p.get('outstanding') ? 'open' : p.get('status') ?? 'all';
  const query = { page, status: p.get('status'), kind: p.get('kind'), overdue: p.get('overdue'), outstanding: p.get('outstanding'), q: p.get('q'), from: p.get('from'), to: p.get('to'), subscriptionId: p.get('subscriptionId'), customerId: p.get('customerId') };
  const path = `/invoices${qs(query)}`;
  const { data, error, reload } = useApi<Page<InvRow> & { sumTotal: number; sumBalance: number }>(path);
  const { data: due, reload: reloadDue } = useApi<{ n: number }>('/billing/due');
  const [picked, setPicked] = useState<number[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState(p.get('q') ?? '');
  useEffect(() => { setPicked([]); }, [path]);
  useEffect(() => { const t = setTimeout(() => { if (q !== (p.get('q') ?? '')) set({ q: q || null }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setNote(null);
    try {
      const r = await api<{ created: number; closed: number }>('/billing/run', { body: {} });
      setNote({ ok: true, text: r.created ? `Billing run created ${count(r.created)} draft invoices. Review and confirm them below.` : 'Every active subscription is already billed up to today.' });
      set({ status: 'draft', overdue: null, outstanding: null });
      reload(); reloadDue();
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };
  const bulk = async (action: 'confirm' | 'send' | 'remind') => {
    setNote(null);
    try {
      const r = await api<{ done: number; failed: { id: number; error: string }[] }>('/invoices/bulk', { body: { ids: picked, action } });
      setNote({ ok: r.failed.length === 0, text: `${action === 'confirm' ? 'Confirmed' : action === 'send' ? 'Sent' : 'Reminded customers about'} ${count(r.done)} invoices.${r.failed.length ? ` ${r.failed.length} skipped: ${r.failed[0].error}` : ''}` });
      setPicked([]); reload();
    } catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };
  const rows = data?.rows ?? [];
  const allPicked = rows.length > 0 && rows.every((r) => picked.includes(r.id));
  return (
    <>
      <PageHead title="Invoices" sub={due?.n ? `${count(due.n)} active subscriptions are due to be billed today.` : 'Every active subscription is billed up to today.'}
        actions={<button className="btn primary" onClick={run} disabled={!due?.n}>{due?.n ? `Run billing for ${count(due.n)}` : 'Billing is up to date'}</button>} />
      {note ? <div className={note.ok ? 'ok-note' : 'error-note'} role="status" style={{ marginBottom: 12 }}>{note.text}</div> : null}
      <section className="panel flush">
        <div style={{ padding: '4px var(--card-pad) 0' }}>
          <div className="tabs" role="tablist" aria-label="Invoice status">
            {TABS.map(([k, label, patch]) => <button key={k} role="tab" aria-selected={k === tab} onClick={() => set(patch)}>{label}</button>)}
          </div>
        </div>
        <div className="filters" style={{ padding: '12px var(--card-pad) 0' }}>
          <input type="search" className="input" placeholder="Invoice number or customer" aria-label="Search invoices" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="muted" htmlFor="from">From</label>
          <input id="from" type="date" className="input" value={p.get('from') ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
          <label className="muted" htmlFor="to">to</label>
          <input id="to" type="date" className="input" value={p.get('to') ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
          {p.get('subscriptionId') || p.get('customerId') ? <button className="btn" onClick={() => set({ subscriptionId: null, customerId: null })}>Show all customers</button> : null}
          <span className="spacer" />
          {data ? <span className="stamp num">{count(data.total)} invoices · {money(data.sumTotal)} · {money(data.sumBalance)} unpaid</span> : null}
          <ExportLink what="invoices" query={query} />
        </div>
        {picked.length > 0 ? (
          <div className="bulkbar" style={{ marginTop: 12 }}>
            <span>{count(picked.length)} selected</span>
            <button className="btn" onClick={() => bulk('confirm')}>Confirm</button>
            <button className="btn" onClick={() => bulk('send')}>Send to customers</button>
            <button className="btn" onClick={() => bulk('remind')}>Send payment reminder</button>
            <button className="btn ghost" onClick={() => setPicked([])}>Clear</button>
          </div>
        ) : null}
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty>{tab === 'overdue' ? 'No invoice is past its due date.' : 'No invoices match these filters.'}</Empty></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th className="check"><input type="checkbox" aria-label="Select all on this page" checked={allPicked} onChange={() => setPicked(allPicked ? [] : rows.map((r) => r.id))} /></th>
                <th>Invoice</th><th>Customer</th><th className="hide-sm">Period</th><th>Status</th><th className="n hide-sm">Due</th><th className="n">Total</th><th className="n">Balance</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} aria-selected={picked.includes(r.id)}>
                    <td className="check"><input type="checkbox" aria-label={`Select ${r.number}`} checked={picked.includes(r.id)} onChange={() => setPicked((ps) => ps.includes(r.id) ? ps.filter((x) => x !== r.id) : [...ps, r.id])} /></td>
                    <td><Link className="link mono" to={`/invoices/${r.id}`}>{r.number}</Link><span className="sub">{r.kind === 'credit_note' ? 'credit note · ' : r.kind === 'upsell' ? 'upgrade · ' : ''}{r.invoiceDate}</span></td>
                    <td className="truncate">{r.customerName}<span className="sub mono">{r.subscriptionNumber}</span></td>
                    <td className="hide-sm num">{periodText(r.periodStart, r.periodEnd)}</td>
                    <td><InvStatus status={r.status} overdue={r.overdue} kind={r.kind} />{r.reminderCount ? <span className="sub">{r.reminderCount} reminder{r.reminderCount === 1 ? '' : 's'}</span> : r.sentAt ? <span className="sub">sent</span> : null}</td>
                    <td className={`n num hide-sm${r.overdue ? ' neg-text' : ''}`}>{r.dueDate}</td>
                    <td className="n"><Money value={r.total} /></td>
                    <td className="n">{r.status === 'cancelled' || r.status === 'draft' || r.kind === 'credit_note' ? <span className="muted">—</span> : <Money value={r.balance} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => set({ page: String(n) })} /> : null}
      </section>
    </>
  );
}

/* ---------- the invoice itself ---------- */
export interface Company { name: string; legalName: string; address: string; gstin: string; email: string; phone: string; invoiceFooter: string }
export interface InvoiceDetail {
  id: number; number: string; kind: string; status: string; note: string; originInvoiceId: number | null; originNumber: string | null; customerGstin: string; company?: Company;
  credits: { id: number; number: string; status: string; total: number; invoiceDate: string }[]; activity?: ActivityRow[]; reminderCount: number; invoiceDate: string; dueDate: string; periodStart: string; periodEnd: string; subtotal: number; discountTotal: number;
  taxTotal: number; total: number; amountPaid: number; balance: number; overdue: boolean; sentAt: string | null; customerId: number; customerName: string; customerEmail: string;
  customerCompany: string; customerAddress: string; subscriptionId: number; subscriptionNumber: string; planName: string; paymentTermsDays: number;
  lines: { id: number; description: string; quantity: number; unitPrice: number; subtotal: number; discount: number; taxRate: number; tax: number; total: number }[];
  payments: { id: number; kind: string; method: string; amount: number; date: string; note: string; provider: string; providerRef: string | null }[];
}

export function InvoiceDocument({ inv }: { inv: InvoiceDetail }) {
  const c = inv.company;
  const credit = inv.kind === 'credit_note';
  return (
    <article className="doc" aria-label={`${credit ? 'Credit note' : 'Invoice'} ${inv.number}`}>
      <div className="doc-head">
        <div className="from"><Mark size={28} /><div><h2>{c?.legalName || c?.name || 'Brightloop Software'}</h2><div className="muted">{c ? <>{c.address}<br />{c.email}{c.phone ? ` · ${c.phone}` : ''}{c.gstin ? <><br />GSTIN {c.gstin}</> : null}</> : 'Coimbatore, Tamil Nadu'}</div></div></div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted">{credit ? 'Credit note' : inv.kind === 'upsell' ? 'Invoice · upgrade' : 'Tax invoice'}</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 500 }}>{inv.number}</div>
          <div style={{ marginTop: 6 }}><InvStatus status={inv.status} overdue={inv.overdue} /></div>
        </div>
      </div>
      <div className="doc-meta">
        <div><div className="k">Billed to</div><div>{inv.customerCompany || inv.customerName}</div><div className="muted">{inv.customerCompany ? inv.customerName : ''}{inv.customerAddress ? <><br />{inv.customerAddress}</> : null}<br />{inv.customerEmail}{inv.customerGstin ? <><br />GSTIN {inv.customerGstin}</> : null}</div></div>
        <div><div className="k">Invoice date</div><div className="num">{dateWords(inv.invoiceDate)}</div><div className="k" style={{ marginTop: 8 }}>Due</div><div className={`num${inv.overdue ? ' neg-text' : ''}`}>{dateWords(inv.dueDate)}</div></div>
        <div><div className="k">{credit ? 'Credits' : 'Service period'}</div><div className="num">{credit ? <span className="mono">{inv.originNumber}</span> : periodWords(inv.periodStart, inv.periodEnd)}</div></div>
        <div><div className="k">Subscription</div><div className="mono">{inv.subscriptionNumber}</div><div className="muted">{inv.planName}</div></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Description</th><th className="n">Qty</th><th className="n">Unit price</th><th className="n hide-sm">Discount</th><th className="n hide-sm">Tax</th><th className="n">Amount</th></tr></thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td><td className="n num">{count(l.quantity)}</td><td className="n"><Money value={l.unitPrice} /></td>
                <td className="n hide-sm">{l.discount ? <span className="num">−{money(l.discount)}</span> : <span className="muted">—</span>}</td>
                <td className="n hide-sm num">{l.taxRate ? <>{money(l.tax)}<span className="sub">{l.taxRate}%</span></> : <span className="muted">—</span>}</td>
                <td className="n"><Money value={l.total} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="doc-totals">
        <KeyValues items={[
          ['Subtotal', <Money value={inv.subtotal} />],
          ...(inv.discountTotal ? [['Discounts', <span className="num">−{money(inv.discountTotal)}</span>] as [string, React.ReactNode]] : []),
          ['Tax', <Money value={inv.taxTotal} />],
          ...(inv.amountPaid ? [['Paid', <span className="num">−{money(inv.amountPaid)}</span>] as [string, React.ReactNode]] : []),
          [inv.amountPaid ? 'Balance due' : 'Total', <Money value={inv.amountPaid ? inv.balance : inv.total} />],
        ]} />
      </div>
      {inv.payments.length ? (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 4px' }}>Payments received</h3>
          <div className="table-wrap"><table><tbody>
            {inv.payments.map((p) => <tr key={p.id}><td className="num">{p.date}</td><td>{p.kind === 'refund' ? 'Refund · ' : ''}{METHOD_LABEL[p.method] ?? p.method}{p.provider === 'razorpay' || p.provider === 'sandbox' ? ' · online' : ''}{p.note ? <span className="sub">{p.note}</span> : null}</td><td className="n"><Money value={p.amount} /></td></tr>)}
          </tbody></table></div>
        </div>
      ) : null}
      {inv.credits?.length ? <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>Credited by {inv.credits.map((x) => `${x.number} (${money(x.total)})`).join(', ')}.</p> : null}
      <p className="muted" style={{ fontSize: 12, marginTop: 24, marginBottom: 0 }}>
        {credit ? `This credit note reverses ${money(inv.total)} of ${inv.originNumber}.${inv.note ? ` Reason: ${inv.note}.` : ''}` : <>{inv.paymentTermsDays ? `Payment terms: ${inv.paymentTermsDays} days from the invoice date.` : 'Payment is due on receipt.'} Please quote {inv.number} with your payment.</>}
        {c?.invoiceFooter ? <><br />{c.invoiceFooter}</> : null}
      </p>
    </article>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: inv, error, reload } = useApi<InvoiceDetail>(`/invoices/${id}`);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [crediting, setCrediting] = useState(false);
  const paying = params.get('pay') === '1';
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!inv) return <Loading />;
  const act = async (action: 'confirm' | 'send' | 'cancel' | 'remind', done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setNote(null);
    try { await api(`/invoices/${inv.id}/${action}`, { method: 'POST' }); setNote({ ok: true, text: done }); reload(); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };
  const canPay = inv.status === 'confirmed' && inv.balance > 0 && inv.kind !== 'credit_note';
  return (
    <>
      <BackLink to="/invoices">Invoices</BackLink>
      <PageHead title={inv.number} pill={<InvStatus status={inv.status} overdue={inv.overdue} />}
        sub={<>{inv.customerName} · <Link to={`/subscriptions/${inv.subscriptionId}`} style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>{inv.subscriptionNumber}</Link>
          {inv.status === 'confirmed' ? <> · {money(inv.balance)} due {inv.overdue ? <span className="neg-text">since {dateWords(inv.dueDate)}</span> : `by ${dateWords(inv.dueDate)}`}</> : null}</>}
        actions={<>
          {inv.status === 'draft' ? <button className="btn primary" onClick={() => act('confirm', 'Confirmed. It can now be sent and paid.')}>Confirm</button> : null}
          {canPay ? <button className="btn primary" onClick={() => setParams({ pay: '1' })}>Record payment</button> : null}
          {inv.status === 'confirmed' || inv.status === 'paid' ? <button className="btn" onClick={() => act('send', `Sent to ${inv.customerEmail}.`)}>{inv.sentAt ? 'Send again' : 'Send'}</button> : null}
          {canPay && inv.kind !== 'credit_note' ? <button className="btn" onClick={() => act('remind', `Payment reminder sent to ${inv.customerEmail}.`)}>Send reminder</button> : null}
          {(inv.status === 'confirmed' || inv.status === 'paid') && inv.kind !== 'credit_note' ? <button className="btn" onClick={() => setCrediting(true)}>Credit note</button> : null}
          <button className="btn" onClick={() => window.print()}>Print</button>
          {(inv.status === 'draft' || inv.status === 'confirmed') && inv.amountPaid === 0 ? <button className="btn danger" onClick={() => act('cancel', 'Cancelled. The period can be billed again.', `Cancel ${inv.number}?`)}>Cancel invoice</button> : null}
        </>} />
      {note ? <div className={note.ok ? 'ok-note' : 'error-note'} role="status" style={{ margin: '-8px 0 12px' }}>{note.text}</div> : null}
      {inv.sentAt ? <p className="stamp no-print" style={{ margin: '-8px 0 12px' }}>Last sent {inv.sentAt} UTC</p> : null}
      <InvoiceDocument inv={inv} />
      {inv.activity?.length ? <Panel title="History" className="no-print" ><ActivityList rows={inv.activity} compact /></Panel> : null}
      {crediting ? <CreditModal inv={inv} onClose={() => setCrediting(false)} onDone={(t) => { setCrediting(false); setNote({ ok: true, text: t }); reload(); }} /> : null}
      {paying && canPay ? <PaymentModal inv={inv} onClose={() => setParams({})} onDone={() => { setParams({}); setNote({ ok: true, text: 'Payment recorded.' }); reload(); }} /> : null}
    </>
  );
}

function PaymentModal({ inv, onClose, onDone }: { inv: InvoiceDetail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ method: 'bank_transfer', amount: toRupeesText(inv.balance), date: todayIso(), note: '' });
  const s = useSubmit(() => api('/payments', { body: { invoiceId: inv.id, method: f.method, amount: toPaise(f.amount), date: f.date, note: f.note } }), onDone);
  return (
    <Modal title={`Record a payment for ${inv.number}`} onClose={onClose}>
      <form className="form" onSubmit={s.run} noValidate>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <div className="form-grid">
          <Field label="Amount, ₹" error={s.fields.amount} hint={`${money(inv.balance)} is still owed`}>{(id) => <input id={id} className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Field label="Received on" error={s.fields.date}>{(id) => <input id={id} type="date" className="input" value={f.date} max={todayIso()} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Method" wide>{(id) => <select id={id} className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            {Object.entries(METHOD_LABEL).filter(([k]) => k !== 'credit_note').map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
          <Field label="Note" wide hint="A reference number, cheque number or anything to find it later">{(id) => <input id={id} className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
        </div>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={s.busy}>Record payment</button></div>
      </form>
    </Modal>
  );
}

function CreditModal({ inv, onClose, onDone }: { inv: InvoiceDetail; onClose: () => void; onDone: (text: string) => void }) {
  const already = inv.credits?.reduce((a, c) => a + c.total, 0) ?? 0;
  const left = inv.total - already;
  const [f, setF] = useState({ amount: toRupeesText(left), reason: '', refundMethod: 'bank_transfer' });
  const s = useSubmit(() => api<{ number: string; total: number; applied: number; refunded: number }>(`/invoices/${inv.id}/credit`, { body: { amount: toPaise(f.amount), reason: f.reason, refundMethod: f.refundMethod } }),
    (r) => onDone(`Credit note ${r.number} for ${money(r.total)} issued${r.refunded ? `; ${money(r.refunded)} to refund by ${METHOD_LABEL[f.refundMethod].toLowerCase()}` : ''}.`));
  return (
    <Modal title={`Credit note for ${inv.number}`} onClose={onClose}>
      <form className="form" onSubmit={s.run} noValidate>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <p className="muted" style={{ marginTop: 0 }}>Reverses part or all of the invoice, tax included. It settles any unpaid balance first; anything already paid is refunded.</p>
        <div className="form-grid">
          <Field label="Amount, ₹ (tax included)" error={s.fields.amount} hint={`${money(left)} can still be credited`}>{(id) => <input id={id} className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          {inv.amountPaid > 0 ? <Field label="Refund by">{(id) => <select id={id} className="input" value={f.refundMethod} onChange={(e) => setF({ ...f, refundMethod: e.target.value })}>
            {['bank_transfer', 'upi', 'card', 'cash', 'cheque'].map((k) => <option key={k} value={k}>{METHOD_LABEL[k]}</option>)}</select>}</Field> : null}
          <Field label="Reason" wide error={s.fields.reason} hint="Printed on the credit note">{(id) => <input id={id} className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Service outage on 12 October" />}</Field>
        </div>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={s.busy}>Issue credit note</button></div>
      </form>
    </Modal>
  );
}

/* ---------- payments ---------- */
interface PayRow { id: number; kind: string; provider: string; method: string; amount: number; date: string; note: string; invoiceId: number; invoiceNumber: string; customerId: number; customerName: string }

export function PaymentsPage() {
  const [p, set] = useQueryState();
  const page = Number(p.get('page') ?? 1);
  const query = { page, method: p.get('method'), provider: p.get('provider'), kind: p.get('kind'), from: p.get('from'), to: p.get('to'), q: p.get('q') };
  const { data, error, reload } = useApi<Page<PayRow> & { sumAmount: number }>(`/payments${qs(query)}`);
  const [q, setQ] = useState(p.get('q') ?? '');
  useEffect(() => { const t = setTimeout(() => { if (q !== (p.get('q') ?? '')) set({ q: q || null }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHead title="Payments" sub={data ? <span className="num">{count(data.total)} payments · {money(data.sumAmount)} received</span> : ' '}
        actions={<Link className="btn" to="/invoices?outstanding=1">Record a payment against an invoice</Link>} />
      <section className="panel flush">
        <div className="filters" style={{ padding: '16px var(--card-pad) 0' }}>
          <input type="search" className="input" placeholder="Invoice, customer or note" aria-label="Search payments" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input" aria-label="Method" value={p.get('method') ?? ''} onChange={(e) => set({ method: e.target.value || null })}>
            <option value="">All methods</option>
            {Object.entries(METHOD_LABEL).filter(([k]) => k !== 'credit_note').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="input" aria-label="Channel" value={p.get('provider') ?? p.get('kind') ?? ''} onChange={(e) => set({ provider: ['online', 'manual'].includes(e.target.value) ? e.target.value : null, kind: e.target.value === 'refund' ? 'refund' : null })}>
            <option value="">Every channel</option><option value="online">Paid online</option><option value="manual">Recorded by staff</option><option value="refund">Refunds</option>
          </select>
          <label className="muted" htmlFor="pf">From</label>
          <input id="pf" type="date" className="input" value={p.get('from') ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
          <label className="muted" htmlFor="pt">to</label>
          <input id="pt" type="date" className="input" value={p.get('to') ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
          <span className="spacer" />
          <ExportLink what="payments" query={query} />
        </div>
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : data.rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty>No payments match these filters.</Empty></div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th className="n">Received</th><th>Customer</th><th>Invoice</th><th className="hide-sm">Method</th><th className="hide-sm">Note</th><th className="n">Amount</th></tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="n num" style={{ width: 110 }}>{r.date}</td>
                    <td className="truncate"><Link to={`/customers/${r.customerId}`}>{r.customerName}</Link></td>
                    <td><Link className="link mono" to={`/invoices/${r.invoiceId}`}>{r.invoiceNumber}</Link></td>
                    <td className="hide-sm">{r.kind === 'refund' ? 'Refund · ' : ''}{METHOD_LABEL[r.method] ?? r.method}{r.provider === 'razorpay' || r.provider === 'sandbox' ? <span className="pill pos" style={{ marginLeft: 6 }}>online</span> : null}</td>
                    <td className="hide-sm truncate muted">{r.note || '—'}</td>
                    <td className="n">{r.kind === 'refund' ? <span className="num neg-text">−{money(r.amount)}</span> : <Money value={r.amount} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => set({ page: String(n) })} /> : null}
      </section>
    </>
  );
}

export { Panel };
