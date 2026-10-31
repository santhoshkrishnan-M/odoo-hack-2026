import { useEffect, useState } from 'react';
import { api, qs, type Page } from '../api';
import { Empty, ErrorNote, Field, Loading, Modal, PageHead, Pager, Panel, useApi, useQueryState, useSubmit } from '../components';
import { count } from '../format';
import { ago, useNow } from '../live';
import type { Company } from './invoices';

interface Billing { autoConfirm: boolean; autoSend: boolean; reminderDays: number[]; dunningCloseDays: number; renewalReminderDays: number; onlinePayments: boolean }
interface Settings { company: Company; billing: Billing; integrations: { email: string; payments: string; cron: boolean; database: string } }
interface Run { id: number; trigger: string; startedAt: string; finishedAt: string | null; ok: number | null; summary: Record<string, number | string> }

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span><span className="toggle-label">{label}</span><span className="hint">{hint}</span></span>
      <input type="checkbox" className="switch" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function SettingsPage() {
  const { data, error, reload } = useApi<Settings>('/admin/settings', { live: false });
  const runs = useApi<{ rows: Run[] }>('/billing/runs');
  const now = useNow();
  const [company, setCompany] = useState<Company | null>(null);
  const [billing, setBilling] = useState<(Omit<Billing, 'reminderDays'> & { reminderDays: string }) | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!data) return;
    setCompany((c) => c ?? data.company);
    setBilling((b) => b ?? { ...data.billing, reminderDays: data.billing.reminderDays.join(', ') });
  }, [data]);
  const sc = useSubmit(() => api('/admin/settings', { method: 'PUT', body: { company } }), () => { setSaved('Company details saved. New invoices and emails use them.'); reload(); });
  const sb = useSubmit(() => api('/admin/settings', { method: 'PUT', body: { billing: { ...billing, reminderDays: billing!.reminderDays.split(/[,\s]+/).filter(Boolean).map(Number) } } }),
    () => { setSaved('Automation settings saved. They apply from the next run.'); reload(); });
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!data || !company || !billing) return <><PageHead title="Settings & automation" /><Loading /></>;
  const runNow = async () => {
    setRunning(true); setRunMsg(null);
    try {
      const r = await api<Record<string, number>>('/billing/automation', { body: {} });
      setRunMsg(`Done in ${count(r.ms)} ms: ${count(r.created)} invoices created, ${count(r.confirmed)} confirmed, ${count(r.sent)} emailed, ${count(r.reminders)} reminders, ${count(r.closed + r.dunningClosed)} closed.`);
      runs.reload();
    } catch (e) { setRunMsg((e as Error).message); } finally { setRunning(false); }
  };
  const ci = (k: keyof Company) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setSaved(null); setCompany({ ...company, [k]: e.target.value }); };
  const it = data.integrations;
  return (
    <>
      <PageHead title="Settings & automation" sub="How Brightloop bills on its own, and the details printed on every invoice." />
      {saved ? <div className="ok-note" role="status" style={{ marginBottom: 12 }}>{saved}</div> : null}
      <div className="cols-2">
        <div className="stack">
          <form onSubmit={sb.run} noValidate>
            <Panel title="Billing automation" meta="runs every day">
              {sb.error ? <ErrorNote error={sb.error} /> : null}
              <Toggle label="Confirm new invoices automatically" hint="Invoices created by the daily run are confirmed straight away instead of waiting as drafts." checked={billing.autoConfirm} onChange={(v) => setBilling({ ...billing, autoConfirm: v })} />
              <Toggle label="Email invoices to customers" hint="Each confirmed invoice is emailed with a link to pay online." checked={billing.autoSend} onChange={(v) => setBilling({ ...billing, autoSend: v })} />
              <Toggle label="Online payments in the portal" hint="Customers pay by UPI, card or net banking from their invoice." checked={billing.onlinePayments} onChange={(v) => setBilling({ ...billing, onlinePayments: v })} />
              <div className="form-grid" style={{ marginTop: 16 }}>
                <Field label="Payment reminders, days after due" error={sb.fields['billing.reminderDays']} hint="e.g. 1, 7, 14 — empty sends none">{(id) => <input id={id} className="input num" value={billing.reminderDays} onChange={(e) => setBilling({ ...billing, reminderDays: e.target.value })} />}</Field>
                <Field label="Renewal reminder, days before end" hint="0 sends none">{(id) => <input id={id} className="input num" inputMode="numeric" value={billing.renewalReminderDays} onChange={(e) => setBilling({ ...billing, renewalReminderDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} />}</Field>
                <Field label="Close unpaid subscriptions after, days overdue" hint="Dunning. 0 never closes automatically" wide>{(id) => <input id={id} className="input num" inputMode="numeric" value={billing.dunningCloseDays} onChange={(e) => setBilling({ ...billing, dunningCloseDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} />}</Field>
              </div>
              <div className="form-actions" style={{ marginTop: 16 }}><button className="btn primary" disabled={sb.busy}>Save automation</button></div>
            </Panel>
          </form>
          <Panel className="flush" title="Automation runs" meta={<button className="btn" onClick={runNow} disabled={running}>{running ? 'Running…' : 'Run now'}</button>}>
            {runMsg ? <div className="ok-note" style={{ margin: '0 20px 12px' }}>{runMsg}</div> : null}
            {!runs.data ? <div style={{ padding: 20 }}><Loading rows={3} /></div> : runs.data.rows.length === 0 ? <div style={{ padding: '0 20px 20px' }}><Empty>The first run happens tonight, or press Run now.</Empty></div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>When</th><th>Started by</th><th className="n">Invoices</th><th className="n hide-sm">Emails</th><th className="n hide-sm">Reminders</th><th className="n">Result</th></tr></thead>
                <tbody>{runs.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td title={r.startedAt}>{ago(r.startedAt, now)}</td>
                    <td>{r.trigger === 'cron' ? 'Schedule' : r.trigger === 'timer' ? 'Server timer' : 'Someone on the team'}</td>
                    <td className="n num">{count(Number(r.summary.created ?? 0))}</td>
                    <td className="n num hide-sm">{count(Number(r.summary.sent ?? 0))}</td>
                    <td className="n num hide-sm">{count(Number(r.summary.reminders ?? 0))}</td>
                    <td className="n">{r.ok === 1 ? <span className="pill pos">{count(Number(r.summary.ms ?? 0))} ms</span> : r.ok === 0 ? <span className="pill neg" title={String(r.summary.error ?? '')}>Failed</span> : <span className="pill">Running</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
        <div className="stack">
          <form onSubmit={sc.run} noValidate>
            <Panel title="Company on invoices">
              {sc.error ? <ErrorNote error={sc.error} /> : null}
              <div className="form-grid">
                <Field label="Trading name" error={sc.fields['company.name']}>{(id) => <input id={id} className="input" value={company.name} onChange={ci('name')} />}</Field>
                <Field label="Legal name">{(id) => <input id={id} className="input" value={company.legalName} onChange={ci('legalName')} />}</Field>
                <Field label="GSTIN" error={sc.fields['company.gstin']}>{(id) => <input id={id} className="input mono" maxLength={15} value={company.gstin} onChange={ci('gstin')} />}</Field>
                <Field label="Billing email" error={sc.fields['company.email']}>{(id) => <input id={id} className="input" value={company.email} onChange={ci('email')} />}</Field>
                <Field label="Phone">{(id) => <input id={id} className="input" value={company.phone} onChange={ci('phone')} />}</Field>
                <Field label="Address" wide>{(id) => <textarea id={id} className="input" value={company.address} onChange={ci('address')} />}</Field>
                <Field label="Invoice footer" wide hint="Bank details, thanks, terms">{(id) => <textarea id={id} className="input" value={company.invoiceFooter} onChange={ci('invoiceFooter')} />}</Field>
              </div>
              <div className="form-actions" style={{ marginTop: 16 }}><button className="btn primary" disabled={sc.busy}>Save company</button></div>
            </Panel>
          </form>
          <Panel title="Connections">
            <dl className="kv">
              <div><dt>Database</dt><dd>{it.database === 'postgres' ? 'PostgreSQL (Neon)' : 'Embedded PostgreSQL (PGlite)'}</dd></div>
              <div><dt>Online payments</dt><dd>{it.payments === 'razorpay' ? 'Razorpay, live keys' : <>Test gateway <span className="muted">— set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to take real payments</span></>}</dd></div>
              <div><dt>Email delivery</dt><dd>{it.email === 'smtp' ? 'SMTP' : <>Logged only <span className="muted">— set SMTP_URL to deliver; every email is in the email log</span></>}</dd></div>
              <div><dt>Daily schedule</dt><dd>{it.cron ? 'Scheduled every morning' : 'Runs from the server timer'}</dd></div>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

interface Mail { id: number; toEmail: string; subject: string; body: string; kind: string; status: string; error: string | null; createdAt: string }

export function EmailLogPage() {
  const [p, set] = useQueryState();
  const page = Number(p.get('page') ?? 1);
  const { data, error, reload } = useApi<Page<Mail> & { delivery: string }>(`/admin/emails${qs({ page, q: p.get('q') })}`);
  const [q, setQ] = useState(p.get('q') ?? '');
  const [open, setOpen] = useState<Mail | null>(null);
  const now = useNow();
  useEffect(() => { const t = setTimeout(() => { if (q !== (p.get('q') ?? '')) set({ q: q || null }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHead title="Email log" sub={data ? `${count(data.total)} emails · ${data.delivery === 'smtp' ? 'delivered by SMTP' : 'logged here (no mail server connected)'}` : ' '} />
      <section className="panel flush">
        <div className="filters" style={{ padding: '16px var(--card-pad) 0' }}>
          <input type="search" className="input" placeholder="Recipient or subject" aria-label="Search emails" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : data.rows.length === 0 ? <div style={{ padding: 20 }}><Empty>No emails yet.</Empty></div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Sent</th><th>To</th><th>Subject</th><th className="hide-sm">Kind</th><th className="n">Status</th></tr></thead>
            <tbody>{data.rows.map((m) => (
              <tr key={m.id}>
                <td className="num" title={m.createdAt}>{ago(m.createdAt, now)}</td>
                <td className="truncate">{m.toEmail}</td>
                <td><button className="card-link" onClick={() => setOpen(m)}>{m.subject}</button></td>
                <td className="hide-sm muted">{m.kind.replace('_', ' ')}</td>
                <td className="n"><span className={`pill ${m.status === 'sent' ? 'pos' : m.status === 'failed' ? 'neg' : ''}`}>{m.status === 'logged' ? 'Logged' : m.status === 'sent' ? 'Delivered' : 'Failed'}</span></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => set({ page: String(n) })} /> : null}
      </section>
      {open ? (
        <Modal title={open.subject} onClose={() => setOpen(null)} wide>
          <p className="muted" style={{ marginTop: 0 }}>To {open.toEmail} · {new Date(open.createdAt).toLocaleString('en-IN')}</p>
          {open.error ? <ErrorNote error={open.error} /> : null}
          <pre className="mail-body">{open.body}</pre>
        </Modal>
      ) : null}
    </>
  );
}
