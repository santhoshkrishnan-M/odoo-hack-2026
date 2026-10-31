import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, type Page } from '../api';
import { ActivityList, BackLink, Empty, ErrorNote, Field, InvStatus, KeyValues, Loading, Modal, Money, PageHead, Pager, Panel, SubStatus, useApi, useQueryState, useSubmit, type ActivityRow } from '../components';
import { count, money, PERIOD_WORD } from '../format';

interface Customer { id: number; name: string; email: string; phone: string; company: string; address: string; gstin?: string; activity?: ActivityRow[]; activeSubscriptions?: number; balance?: number; hasPortal?: number }

export function CustomersPage() {
  const [p, set] = useQueryState();
  const page = Number(p.get('page') ?? 1);
  const { data, error, reload } = useApi<Page<Customer>>(`/customers${qs({ page, q: p.get('q') })}`);
  const [q, setQ] = useState(p.get('q') ?? '');
  const [adding, setAdding] = useState(false);
  const nav = useNavigate();
  useEffect(() => { const t = setTimeout(() => { if (q !== (p.get('q') ?? '')) set({ q: q || null }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHead title="Customers" sub={data ? `${count(data.total)} customers` : ' '} actions={<button className="btn primary" onClick={() => setAdding(true)}>Add customer</button>} />
      <section className="panel flush">
        <div className="filters" style={{ padding: '16px var(--card-pad) 0' }}>
          <input type="search" className="input" placeholder="Name, company or email" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : data.rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty>No customers match “{p.get('q')}”.</Empty></div>
        ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Customer</th><th className="hide-sm">Email</th><th className="hide-sm">Portal</th><th className="n">Active subscriptions</th><th className="n">Owed</th></tr></thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="link" to={`/customers/${c.id}`}>{c.name}</Link><span className="sub">{c.company || '—'}</span></td>
                    <td className="hide-sm truncate">{c.email}</td>
                    <td className="hide-sm">{c.hasPortal ? 'Signed up' : <span className="muted">—</span>}</td>
                    <td className="n num">{count(c.activeSubscriptions ?? 0)}</td>
                    <td className="n"><Money value={c.balance ?? 0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data ? <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => set({ page: String(n) })} /> : null}
      </section>
      {adding ? <CustomerModal onClose={() => setAdding(false)} onSaved={(id) => nav(`/customers/${id}`)} /> : null}
    </>
  );
}

function CustomerModal({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (id: number) => void }) {
  const [f, setF] = useState({ name: customer?.name ?? '', email: customer?.email ?? '', phone: customer?.phone ?? '', company: customer?.company ?? '', address: customer?.address ?? '', gstin: customer?.gstin ?? '' });
  const s = useSubmit(async () => {
    if (customer) { await api(`/customers/${customer.id}`, { method: 'PUT', body: f }); return { id: customer.id }; }
    return api<{ id: number }>('/customers', { body: f });
  }, (r) => onSaved(r.id));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={customer ? `Edit ${customer.name}` : 'Add a customer'} onClose={onClose}>
      <form className="form" onSubmit={s.run} noValidate>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <div className="form-grid">
          <Field label="Contact name" error={s.fields.name}>{(id) => <input id={id} className="input" value={f.name} onChange={set('name')} />}</Field>
          <Field label="Company">{(id) => <input id={id} className="input" value={f.company} onChange={set('company')} />}</Field>
          <Field label="GSTIN" error={s.fields.gstin}>{(id) => <input id={id} className="input mono" maxLength={15} value={f.gstin} onChange={set('gstin')} />}</Field>
          <Field label="Email" error={s.fields.email} hint="Invoices are sent here">{(id) => <input id={id} type="email" className="input" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Phone">{(id) => <input id={id} className="input" value={f.phone} onChange={set('phone')} />}</Field>
          <Field label="Billing address" wide>{(id) => <textarea id={id} className="input" value={f.address} onChange={set('address')} />}</Field>
        </div>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={s.busy}>Save</button></div>
      </form>
    </Modal>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const c = useApi<Customer>(`/customers/${id}`);
  const subs = useApi<Page<{ id: number; number: string; status: string; planName: string; period: string; recurringAmount: number; nextInvoiceDate: string | null; expiryDate: string | null }>>(`/subscriptions?customerId=${id}`);
  const open = useApi<Page<{ id: number; number: string; status: string; dueDate: string; total: number; balance: number; overdue: number; invoiceDate: string }> & { sumBalance: number }>(`/invoices?customerId=${id}&outstanding=1`);
  const recent = useApi<Page<{ id: number; number: string; status: string; dueDate: string; total: number; balance: number; overdue: number; invoiceDate: string }>>(`/invoices?customerId=${id}`);
  const [editing, setEditing] = useState(false);
  if (c.error) return <ErrorNote error={c.error} />;
  if (!c.data) return <Loading />;
  const cu = c.data;
  return (
    <>
      <BackLink to="/customers">Customers</BackLink>
      <PageHead title={cu.name} sub={[cu.company, cu.email].filter(Boolean).join(' · ')}
        actions={<>
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
          <Link className="btn primary" to={`/subscriptions/new?customerId=${cu.id}`}>New subscription</Link>
        </>} />
      <div className="kpis">
        <div className="kpi lead"><div className="kpi-label">Owed now</div><div className={`kpi-value num${open.data?.sumBalance ? '' : ' zero'}`}>{money(open.data?.sumBalance ?? 0)}</div>
          <div className="delta">{count(open.data?.total ?? 0)} unpaid invoices</div></div>
        <div className="kpi"><div className="kpi-label">Subscriptions</div><div className="kpi-value num">{count(subs.data?.total ?? 0)}</div>
          <div className="delta">{count(subs.data?.rows.filter((s) => s.status === 'active').length ?? 0)} active</div></div>
        <div className="kpi"><div className="kpi-label">Invoices to date</div><div className="kpi-value num">{count(recent.data?.total ?? 0)}</div>
          <div className="delta">since the first subscription</div></div>
      </div>
      <div className="cols-2">
        <div className="stack">
          <Panel className="flush" title="Subscriptions">
            {subs.data?.rows.length === 0 ? <div style={{ padding: '0 20px 20px' }}><Empty>No subscriptions yet.</Empty></div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Subscription</th><th>Plan</th><th>Status</th><th className="n">Recurring</th></tr></thead>
                <tbody>{subs.data?.rows.map((s) => (
                  <tr key={s.id}><td><Link className="link mono" to={`/subscriptions/${s.id}`}>{s.number}</Link></td><td>{s.planName}</td><td><SubStatus status={s.status} /></td>
                    <td className="n"><Money value={s.recurringAmount} /><span className="sub">per {PERIOD_WORD[s.period]}</span></td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
          <Panel className="flush" title="Recent invoices" meta={<Link className="card-link" to={`/invoices?customerId=${cu.id}`}>All invoices</Link>}>
            {recent.data?.rows.length === 0 ? <div style={{ padding: '0 20px 20px' }}><Empty>No invoices yet.</Empty></div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Invoice</th><th>Status</th><th className="n hide-sm">Due</th><th className="n">Total</th><th className="n">Balance</th></tr></thead>
                <tbody>{recent.data?.rows.slice(0, 8).map((i) => (
                  <tr key={i.id}><td><Link className="link mono" to={`/invoices/${i.id}`}>{i.number}</Link><span className="sub">{i.invoiceDate}</span></td><td><InvStatus status={i.status} overdue={i.overdue} /></td>
                    <td className="n num hide-sm">{i.dueDate}</td><td className="n"><Money value={i.total} /></td>
                    <td className="n">{i.status === 'cancelled' || i.status === 'draft' ? <span className="muted">—</span> : <Money value={i.balance} />}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
        <Panel title="Contact">
          <KeyValues items={[['Name', cu.name], ['Company', cu.company || '—'], ['GSTIN', cu.gstin || '—'], ['Email', cu.email], ['Phone', cu.phone || '—'], ['Address', cu.address || '—']]} />
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 8px' }}>Recent activity</h3>
          <ActivityList rows={cu.activity ?? []} compact />
        </Panel>
      </div>
      {editing ? <CustomerModal customer={cu} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); c.reload(); }} /> : null}
    </>
  );
}
