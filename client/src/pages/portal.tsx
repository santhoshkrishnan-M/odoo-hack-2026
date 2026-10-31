import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, qs, type Page } from '../api';
import { ActivityList, BackLink, Empty, ErrorNote, Field, InvStatus, KeyValues, Loading, Money, PageHead, Pager, Panel, SubStatus, useApi, useQueryState, useSubmit, type ActivityRow } from '../components';
import { PayButton } from './pay';
import { count, dateWords, money, PERIOD_ADJ, PERIOD_WORD, TERMS_LABEL, todayIso } from '../format';
import { InvoiceDocument, type InvoiceDetail } from './invoices';
import { CloseModal, StatusPath, subscriptionActions } from './subscriptions';

interface PSub { id: number; number: string; status: string; startDate: string; expiryDate: string | null; nextInvoiceDate: string | null; validUntil: string | null;
  planName: string; period: string; pausable: boolean; closable: boolean; renewable: boolean; recurringAmount: number; source: string; openInvoiceId: number | null }

async function runAction(id: number, action: string, confirmText?: string) {
  if (confirmText && !window.confirm(confirmText)) return null;
  return api<{ status: string }>(`/portal/subscriptions/${id}/actions/${action}`, { method: 'POST' });
}

export function PortalHome() {
  const { data, error, reload } = useApi<Page<PSub>>('/portal/subscriptions');
  const open = useApi<Page<{ id: number }> & { sumBalance: number }>('/portal/invoices?outstanding=1');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [closing, setClosing] = useState<PSub | null>(null);
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <><PageHead title="Your subscriptions" /><Loading /></>;
  const quotes = data.rows.filter((s) => s.status === 'quotation');
  const running = data.rows.filter((s) => ['active', 'paused', 'confirmed'].includes(s.status));
  const ended = data.rows.filter((s) => s.status === 'closed');
  const act = async (s: PSub, a: { action: string; label: string; confirm?: string }) => {
    setNote(null);
    if (a.action === 'close' && ['confirmed', 'active', 'paused'].includes(s.status)) { setClosing(s); return; }
    try { const r = await runAction(s.id, a.action, a.confirm); if (r) { setNote({ ok: true, text: `${s.number}: ${a.label.toLowerCase()} done.` }); reload(); open.reload(); } }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };
  const owed = open.data?.sumBalance ?? 0;
  return (
    <>
      <PageHead title="Your subscriptions" sub={running.length ? `${count(running.length)} running${owed ? ` · ${money(owed)} to pay on ${count(open.data?.total ?? 0)} invoices` : ' · nothing to pay right now'}` : 'Nothing running yet.'}
        actions={<><Link className="btn" to="/portal/plans">Browse plans</Link>{owed ? <Link className="btn primary" to="/portal/invoices?outstanding=1">See what to pay</Link> : null}</>} />
      {note ? <div className={note.ok ? 'ok-note' : 'error-note'} role="status" style={{ marginBottom: 12 }}>{note.text}</div> : null}
      {closing ? <CloseModal subId={closing.id} number={closing.number} portal onClose={() => setClosing(null)} onDone={() => { setClosing(null); setNote({ ok: true, text: `${closing.number} is closed.` }); reload(); }} /> : null}
      {quotes.map((q) => (
        <div className="callout" key={q.id}>
          <div><strong>Quotation {q.number} is waiting for you.</strong> <span className="muted">{q.planName}, {money(q.recurringAmount)} per {PERIOD_WORD[q.period]} before tax{q.validUntil ? `, valid until ${dateWords(q.validUntil)}` : ''}.</span></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link className="btn" to={`/portal/subscriptions/${q.id}`}>Review</Link>
            <button className="btn primary" onClick={() => act(q, { action: 'accept', label: 'Accept' })}>Accept</button>
          </div>
        </div>
      ))}
      {running.length === 0 && quotes.length === 0 ? <Empty>You have no subscriptions yet. <Link to="/portal/plans" style={{ textDecoration: 'underline' }}>Browse plans</Link> to order one, or accept a quotation Brightloop sends you.</Empty> : null}
      <div className="sub-cards">
        {running.map((s) => (
          <section className="panel sub-card" key={s.id}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 0 }}>
              <h3><Link to={`/portal/subscriptions/${s.id}`}>{s.planName}</Link></h3><SubStatus status={s.status} />
            </header>
            <div className="muted mono" style={{ fontFamily: 'var(--font)', fontSize: 12 }}>{s.number}</div>
            <div className="amount num">{money(s.recurringAmount)} <span className="muted" style={{ fontSize: 14 }}>per {PERIOD_WORD[s.period]}, before tax</span></div>
            <div className="muted">{s.status === 'active' && s.nextInvoiceDate && (!s.expiryDate || s.nextInvoiceDate < s.expiryDate) ? `Next invoice on ${dateWords(s.nextInvoiceDate)}` : s.status === 'paused' ? 'Paused: no invoices until you resume' : s.status === 'confirmed' ? (s.source === 'portal' ? 'Starts as soon as the first invoice is paid' : 'Starts once Brightloop activates it') : 'No further invoices'}
              {s.expiryDate ? ` · ends ${dateWords(s.expiryDate)}` : ''}</div>
            <div className="actions">
              {s.openInvoiceId ? <Link className="btn primary" to={`/portal/invoices/${s.openInvoiceId}?pay=1`}>Pay invoice</Link> : null}
              <Link className="btn" to={`/portal/subscriptions/${s.id}`}>Details</Link>
              {subscriptionActions(s, true).map((a) => <button key={a.action} className={`btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`} onClick={() => act(s, a)}>{a.label}</button>)}
            </div>
          </section>
        ))}
      </div>
      {ended.length ? (
        <Panel className="flush" title="Ended" meta={`${ended.length} ${ended.length === 1 ? "subscription" : "subscriptions"}`}>
          <div className="table-wrap"><table><tbody>{ended.map((s) => (
            <tr key={s.id}><td><Link className="link" to={`/portal/subscriptions/${s.id}`}>{s.planName}</Link><span className="sub">{s.number}</span></td><td className="n num">{s.startDate} to {s.expiryDate ?? '—'}</td>
              <td className="n">{subscriptionActions(s, true).filter((a) => a.action === 'renew').map((a) => <button key={a.action} className="btn" onClick={() => act(s, a)}>Renew</button>)}</td></tr>
          ))}</tbody></table></div>
        </Panel>
      ) : null}
    </>
  );
}

export function PortalSubscription() {
  const { id } = useParams();
  const { data: s, error, reload } = useApi<PSub & { planPrice: number; paymentTermsDays: number; customerName: string; autoClose: boolean; notes: string;
    lines: { id: number; description: string; quantity: number; unitPrice: number; amount: number; taxName: string | null }[];
    invoices: { id: number; number: string; kind: string; status: string; invoiceDate: string; dueDate: string; total: number; amountPaid: number }[]; activity: ActivityRow[] }>(`/portal/subscriptions/${id}`);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [closing, setClosing] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!s) return <Loading />;
  const act = async (a: { action: string; label: string; confirm?: string }) => {
    setNote(null);
    if (a.action === 'close' && ['confirmed', 'active', 'paused'].includes(s.status)) { setClosing(true); return; }
    try { const r = await runAction(s.id, a.action, a.confirm); if (r) { setNote({ ok: true, text: `${a.label} done.` }); reload(); } }
    catch (e) { setNote({ ok: false, text: (e as Error).message }); }
  };
  const recurring = s.planPrice + s.lines.reduce((a, l) => a + l.amount, 0);
  return (
    <>
      <BackLink to="/portal">Your subscriptions</BackLink>
      <PageHead title={s.planName} pill={<SubStatus status={s.status} />} sub={<>{s.number} · {money(recurring)} per {PERIOD_WORD[s.period]} before tax</>}
        actions={<>{subscriptionActions(s, true).map((a) => <button key={a.action} className={`btn${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`} onClick={() => act(a)}>{a.label}</button>)}</>} />
      {note ? <div className={note.ok ? 'ok-note' : 'error-note'} role="status" style={{ margin: '-8px 0 12px' }}>{note.text}</div> : null}
      {closing ? <CloseModal subId={s.id} number={s.number} portal onClose={() => setClosing(false)} onDone={() => { setClosing(false); setNote({ ok: true, text: 'Closed. You will not be billed again.' }); reload(); }} /> : null}
      <StatusPath status={s.status} />
      <div className="cols-2">
        <div className="stack">
          <Panel className="flush" title="What you pay for">
            <div className="table-wrap"><table>
              <thead><tr><th>Item</th><th className="n">Qty</th><th className="n">Unit price</th><th className="n">Amount</th></tr></thead>
              <tbody>
                <tr><td>{s.planName}<span className="sub">plan fee</span></td><td className="n num">1</td><td className="n"><Money value={s.planPrice} /></td><td className="n"><Money value={s.planPrice} /></td></tr>
                {s.lines.map((l) => <tr key={l.id}><td>{l.description}</td><td className="n num">{count(l.quantity)}</td><td className="n"><Money value={l.unitPrice} /></td><td className="n"><Money value={l.amount} /></td></tr>)}
              </tbody>
              <tfoot><tr><td colSpan={3}>Per {PERIOD_WORD[s.period]}, before tax</td><td className="n"><Money value={recurring} strong /></td></tr></tfoot>
            </table></div>
          </Panel>
          <Panel className="flush" title="Invoices">
            {s.invoices.length === 0 ? <div style={{ padding: '0 20px 20px' }}><Empty>No invoices yet.</Empty></div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Invoice</th><th>Status</th><th className="n">Total</th><th className="n">To pay</th><th><span className="sr-only">Pay</span></th></tr></thead>
                <tbody>{s.invoices.map((i) => (
                  <tr key={i.id}><td><Link className="link mono" to={`/portal/invoices/${i.id}`}>{i.number}</Link><span className="sub">{i.kind === 'credit_note' ? 'credit note · ' : ''}{i.invoiceDate}</span></td>
                    <td><InvStatus status={i.status} kind={i.kind} overdue={i.status === 'confirmed' && i.kind !== 'credit_note' && i.dueDate < todayIso()} /></td><td className="n"><Money value={i.total} /></td>
                    <td className="n">{i.kind === 'credit_note' ? <span className="muted">—</span> : <Money value={i.total - i.amountPaid} />}</td>
                    <td className="n">{i.status === 'confirmed' && i.kind !== 'credit_note' && i.total > i.amountPaid ? <PayButton invoiceId={i.id} amount={i.total - i.amountPaid} onPaid={reload} primary={false} label="Pay" /> : null}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
        <Panel title="Terms">
          <KeyValues items={[
            ['Billing', `${PERIOD_ADJ[s.period]}`], ['Started', dateWords(s.startDate)], ['Ends', s.expiryDate ? dateWords(s.expiryDate) : 'Runs until you close it'],
            ['Payment terms', TERMS_LABEL[s.paymentTermsDays]], ...(s.status === 'quotation' && s.validUntil ? [['Offer valid until', dateWords(s.validUntil)] as [string, string]] : []),
            ['You can', [s.pausable && 'pause', s.closable && 'close early', s.renewable && 'renew'].filter(Boolean).join(', ') || '—'],
          ]} />
          {s.notes ? <p className="muted" style={{ marginBottom: 0 }}>{s.notes}</p> : null}
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 8px' }}>History</h3>
          <ActivityList rows={s.activity} compact />
        </Panel>
      </div>
    </>
  );
}

export function PortalInvoices() {
  const [p, set] = useQueryState();
  const page = Number(p.get('page') ?? 1);
  const outstanding = p.get('outstanding') === '1';
  const { data, error, reload } = useApi<Page<{ id: number; number: string; kind: string; status: string; invoiceDate: string; dueDate: string; total: number; balance: number; overdue: number; subscriptionNumber: string }> & { sumBalance: number }>(
    `/portal/invoices${qs({ page, outstanding: outstanding ? '1' : null, status: p.get('status') })}`);
  return (
    <>
      <PageHead title="Invoices" sub={data ? (outstanding ? `${money(data.sumBalance)} to pay on ${count(data.total)} invoices` : `${count(data.total)} invoices`) : ' '} />
      <section className="panel flush">
        <div style={{ padding: '4px var(--card-pad) 0' }}><div className="tabs" role="tablist">
          <button role="tab" aria-selected={!outstanding && !p.get('status')} onClick={() => set({ outstanding: null, status: null })}>All</button>
          <button role="tab" aria-selected={outstanding} onClick={() => set({ outstanding: '1', status: null })}>To pay</button>
          <button role="tab" aria-selected={p.get('status') === 'paid'} onClick={() => set({ outstanding: null, status: 'paid' })}>Paid</button>
        </div></div>
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : data.rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty>{outstanding ? 'Nothing to pay. Thank you.' : 'No invoices yet.'}</Empty></div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}><table>
            <thead><tr><th>Invoice</th><th className="hide-sm">Subscription</th><th>Status</th><th className="n hide-sm">Due</th><th className="n">Total</th><th className="n">To pay</th><th><span className="sr-only">Pay</span></th></tr></thead>
            <tbody>{data.rows.map((i) => (
              <tr key={i.id}><td><Link className="link mono" to={`/portal/invoices/${i.id}`}>{i.number}</Link><span className="sub">{i.kind === 'credit_note' ? 'credit note · ' : ''}{i.invoiceDate}</span></td><td className="hide-sm mono">{i.subscriptionNumber}</td>
                <td><InvStatus status={i.status} overdue={i.overdue} kind={i.kind} /></td><td className={`n num hide-sm${i.overdue ? ' neg-text' : ''}`}>{i.dueDate}</td><td className="n"><Money value={i.total} /></td>
                <td className="n">{i.kind === 'credit_note' ? <span className="muted">—</span> : <Money value={i.balance} />}</td>
                <td className="n">{i.status === 'confirmed' && i.kind !== 'credit_note' && i.balance > 0 ? <PayButton invoiceId={i.id} amount={i.balance} onPaid={reload} primary={false} label="Pay" /> : null}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => set({ page: String(n) })} /> : null}
      </section>
    </>
  );
}

export function PortalInvoice() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data: inv, error, reload } = useApi<InvoiceDetail & { onlinePayments: boolean; provider: string }>(`/portal/invoices/${id}`);
  const [paid, setPaid] = useState(false);
  if (error) return <ErrorNote error={error} />;
  if (!inv) return <Loading />;
  const credit = inv.kind === 'credit_note';
  const payable = !credit && inv.status === 'confirmed' && inv.balance > 0 && inv.onlinePayments;
  return (
    <>
      <BackLink to="/portal/invoices">Invoices</BackLink>
      <PageHead title={inv.number} pill={<InvStatus status={inv.status} overdue={inv.overdue} kind={inv.kind} />}
        sub={credit ? `A credit of ${money(inv.total)} against ${inv.originNumber}.` : inv.balance > 0 ? <>{money(inv.balance)} to pay by {dateWords(inv.dueDate)}. Pay online now, or quote {inv.number} with a bank transfer.</> : 'Paid in full. Thank you.'}
        actions={<>{payable ? <PayButton invoiceId={inv.id} amount={inv.balance} onPaid={() => { setPaid(true); reload(); }} /> : null}<button className="btn" onClick={() => window.print()}>Print or save as PDF</button></>} />
      {paid ? <div className="ok-note" role="status" style={{ margin: '-8px 0 12px' }}>Payment received — thank you. A receipt is on its way to your email.</div> : null}
      {payable && params.get('pay') === '1' && !paid ? <div className="callout no-print"><div><strong>Your order is ready.</strong> <span className="muted">Pay {money(inv.balance)} to start the subscription straight away.</span></div>
        <PayButton invoiceId={inv.id} amount={inv.balance} onPaid={() => { setPaid(true); reload(); }} /></div> : null}
      <InvoiceDocument inv={inv} />
    </>
  );
}

export function PortalProfile() {
  const { data, reload } = useApi<{ name: string; email: string; phone: string; company: string; address: string; gstin: string }>('/portal/profile', { live: false });
  const [f, setF] = useState<{ name: string; phone: string; company: string; address: string; gstin: string } | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (data && !f) setF({ name: data.name, phone: data.phone, company: data.company, address: data.address, gstin: data.gstin ?? '' }); }, [data, f]);
  const s = useSubmit(() => api('/portal/profile', { method: 'PUT', body: f }), () => { setSaved(true); reload(); });
  if (!data || !f) return <Loading />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setSaved(false); setF({ ...f, [k]: e.target.value }); };
  return (
    <>
      <PageHead title="Profile" sub="These details appear on your invoices." />
      <form onSubmit={s.run} noValidate style={{ maxWidth: 720 }}>
        <Panel>
          {s.error ? <ErrorNote error={s.error} /> : null}
          {saved ? <div className="ok-note" role="status" style={{ marginBottom: 16 }}>Saved.</div> : null}
          <div className="form-grid">
            <Field label="Name" error={s.fields.name}>{(id) => <input id={id} className="input" value={f.name} onChange={set('name')} />}</Field>
            <Field label="Company">{(id) => <input id={id} className="input" value={f.company} onChange={set('company')} />}</Field>
            <Field label="Email" hint="Ask Brightloop to change the email on your account">{(id) => <input id={id} className="input" value={data.email} readOnly aria-readonly="true" />}</Field>
            <Field label="Phone">{(id) => <input id={id} className="input" value={f.phone} onChange={set('phone')} />}</Field>
            <Field label="GSTIN" error={s.fields.gstin} hint="Printed on your tax invoices">{(id) => <input id={id} className="input mono" value={f.gstin} maxLength={15} onChange={set('gstin')} />}</Field>
            <Field label="Billing address" wide>{(id) => <textarea id={id} className="input" value={f.address} onChange={set('address')} />}</Field>
          </div>
          <div className="form-actions" style={{ marginTop: 16 }}><Link className="btn" to="/forgot-password">Change password</Link><button className="btn primary" disabled={s.busy}>Save</button></div>
        </Panel>
      </form>
    </>
  );
}
