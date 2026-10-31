import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, qs, type Page } from '../api';
import { BackLink, Empty, ErrorNote, Field, InvStatus, KeyValues, Loading, Modal, Money, PageHead, Pager, Panel, useApi, useQueryState, useSubmit } from '../components';
import { count, dateWords, METHOD_LABEL, money, periodText, periodWords, todayIso, toPaise, toRupeesText } from '../format';
import { Mark } from '../icons';

interface InvRow { id: number; number: string; status: string; invoiceDate: string; dueDate: string; periodStart: string; periodEnd: string; total: number;
  amountPaid: number; balance: number; sentAt: string | null; customerId: number; customerName: string; subscriptionNumber: string; overdue: number }

const TABS: [string, string, Record<string, string | null>][] = [
  ['all', 'All', { status: null, overdue: null, outstanding: null }],
  ['draft', 'Draft', { status: 'draft', overdue: null, outstanding: null }],
  ['open', 'Awaiting payment', { status: null, overdue: null, outstanding: '1' }],
  ['overdue', 'Overdue', { status: null, overdue: '1', outstanding: null }],
  ['paid', 'Paid', { status: 'paid', overdue: null, outstanding: null }],
  ['cancelled', 'Cancelled', { status: 'cancelled', overdue: null, outstanding: null }],
];

export function InvoicesPage() {
  const [p, set] = useQueryState();
  const page = Number(p.get('page') ?? 1);
  const tab = p.get('overdue') ? 'overdue' : p.get('outstanding') ? 'open' : p.get('status') ?? 'all';
  const path = `/invoices${qs({ page, status: p.get('status'), overdue: p.get('overdue'), outstanding: p.get('outstanding'), q: p.get('q'), from: p.get('from'), to: p.get('to'), subscriptionId: p.get('subscriptionId'), customerId: p.get('customerId') })}`;
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
  const bulk = async (action: 'confirm' | 'send') => {
    setNote(null);
    try {
      const r = await api<{ done: number; failed: { id: number; error: string }[] }>('/invoices/bulk', { body: { ids: picked, action } });
      setNote({ ok: r.failed.length === 0, text: `${action === 'confirm' ? 'Confirmed' : 'Sent'} ${count(r.done)} invoices.${r.failed.length ? ` ${r.failed.length} skipped: ${r.failed[0].error}` : ''}` });
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
        </div>
        {picked.length > 0 ? (
          <div className="bulkbar" style={{ marginTop: 12 }}>
            <span>{count(picked.length)} selected</span>
            <button className="btn" onClick={() => bulk('confirm')}>Confirm</button>
            <button className="btn" onClick={() => bulk('send')}>Send to customers</button>
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
                    <td><Link className="link mono" to={`/invoices/${r.id}`}>{r.number}</Link><span className="sub">{r.invoiceDate}</span></td>
                    <td className="truncate">{r.customerName}<span className="sub mono">{r.subscriptionNumber}</span></td>
                    <td className="hide-sm num">{periodText(r.periodStart, r.periodEnd)}</td>
                    <td><InvStatus status={r.status} overdue={r.overdue} />{r.sentAt ? <span className="sub">sent</span> : null}</td>
                    <td className={`n num hide-sm${r.overdue ? ' neg-text' : ''}`}>{r.dueDate}</td>
                    <td className="n"><Money value={r.total} /></td>
                    <td className="n">{r.status === 'cancelled' || r.status === 'draft' ? <span className="muted">—</span> : <Money value={r.balance} />}</td>
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
export interface InvoiceDetail {
  id: number; number: string; status: string; invoiceDate: string; dueDate: string; periodStart: string; periodEnd: string; subtotal: number; discountTotal: number;
  taxTotal: number; total: number; amountPaid: number; balance: number; overdue: boolean; sentAt: string | null; customerId: number; customerName: string; customerEmail: string;
  customerCompany: string; customerAddress: string; subscriptionId: number; subscriptionNumber: string; planName: string; paymentTermsDays: number;
  lines: { id: number; description: string; quantity: number; unitPrice: number; subtotal: number; discount: number; taxRate: number; tax: number; total: number }[];
  payments: { id: number; method: string; amount: number; date: string; note: string }[];
}

export function InvoiceDocument({ inv }: { inv: InvoiceDetail }) {
  return (
    <article className="doc" aria-label={`Invoice ${inv.number}`}>
      <div className="doc-head">
        <div className="from"><Mark size={28} /><div><h2>Brightloop Software</h2><div className="muted">Subscription software · Coimbatore, Tamil Nadu<br />billing@brightloop.test</div></div></div>
        <div style={{ textAlign: 'right' }}>
          <div className="muted">Invoice</div>
          <div className="mono" style={{ fontSize: 18, fontWeight: 500 }}>{inv.number}</div>
          <div style={{ marginTop: 6 }}><InvStatus status={inv.status} overdue={inv.overdue} /></div>
        </div>
      </div>
      <div className="doc-meta">
        <div><div className="k">Billed to</div><div>{inv.customerCompany || inv.customerName}</div><div className="muted">{inv.customerCompany ? inv.customerName : ''}{inv.customerAddress ? <><br />{inv.customerAddress}</> : null}<br />{inv.customerEmail}</div></div>
        <div><div className="k">Invoice date</div><div className="num">{dateWords(inv.invoiceDate)}</div><div className="k" style={{ marginTop: 8 }}>Due</div><div className={`num${inv.overdue ? ' neg-text' : ''}`}>{dateWords(inv.dueDate)}</div></div>
        <div><div className="k">Service period</div><div className="num">{periodWords(inv.periodStart, inv.periodEnd)}</div></div>
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
            {inv.payments.map((p) => <tr key={p.id}><td className="num">{p.date}</td><td>{METHOD_LABEL[p.method]}{p.note ? <span className="sub">{p.note}</span> : null}</td><td className="n"><Money value={p.amount} /></td></tr>)}
          </tbody></table></div>
        </div>
      ) : null}
      <p className="muted" style={{ fontSize: 12, marginTop: 24, marginBottom: 0 }}>
        {inv.paymentTermsDays ? `Payment terms: ${inv.paymentTermsDays} days from the invoice date.` : 'Payment is due on receipt.'} Please quote {inv.number} with your payment.
      </p>
    </article>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data: inv, error, reload } = useApi<InvoiceDetail>(`/invoices/${id}`);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const paying = params.get('pay') === '1';
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!inv) return <Loading />;
  const act = async (action: 'confirm' | 'send' | 'cancel', done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setNote(null);
    try { await api(`/invoices/${inv.id}/${action}`, { method: 'POST' }); setNote({ ok: true, text: done }); reload(); }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };
  const canPay = inv.status === 'confirmed' && inv.balance > 0;
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
          <button className="btn" onClick={() => window.print()}>Print</button>
          {(inv.status === 'draft' || inv.status === 'confirmed') && inv.amountPaid === 0 ? <button className="btn danger" onClick={() => act('cancel', 'Cancelled. The period can be billed again.', `Cancel ${inv.number}?`)}>Cancel invoice</button> : null}
        </>} />
      {note ? <div className={note.ok ? 'ok-note' : 'error-note'} role="status" style={{ margin: '-8px 0 12px' }}>{note.text}</div> : null}
      {inv.sentAt ? <p className="stamp no-print" style={{ margin: '-8px 0 12px' }}>Last sent {inv.sentAt} UTC</p> : null}
      <InvoiceDocument inv={inv} />
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
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
          <Field label="Note" wide hint="A reference number, cheque number or anything to find it later">{(id) => <input id={id} className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
        </div>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={s.busy}>Record payment</button></div>
      </form>
    </Modal>
  );
}

/* ---------- payments ---------- */
interface PayRow { id: number; method: string; amount: number; date: string; note: string; invoiceId: number; invoiceNumber: string; customerId: number; customerName: string }

export function PaymentsPage() {
  const [p, set] = useQueryState();
  const page = Number(p.get('page') ?? 1);
  const { data, error, reload } = useApi<Page<PayRow> & { sumAmount: number }>(`/payments${qs({ page, method: p.get('method'), from: p.get('from'), to: p.get('to'), q: p.get('q') })}`);
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
            {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="muted" htmlFor="pf">From</label>
          <input id="pf" type="date" className="input" value={p.get('from') ?? ''} onChange={(e) => set({ from: e.target.value || null })} />
          <label className="muted" htmlFor="pt">to</label>
          <input id="pt" type="date" className="input" value={p.get('to') ?? ''} onChange={(e) => set({ to: e.target.value || null })} />
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
                    <td className="hide-sm">{METHOD_LABEL[r.method]}</td>
                    <td className="hide-sm truncate muted">{r.note || '—'}</td>
                    <td className="n"><Money value={r.amount} /></td>
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
