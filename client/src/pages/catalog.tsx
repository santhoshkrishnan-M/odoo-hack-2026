import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import { BackLink, Empty, ErrorNote, Field, Loading, Modal, Money, PageHead, Panel, Picker, useApi, useSubmit } from '../components';
import { count, dateWords, money, PERIOD_ADJ, PERIOD_WORD, todayIso, toPaise, toRupeesText } from '../format';
import type { Plan, Product, Tax } from './subscriptions';
import { QuoteModal } from './subscriptions';

const useIsAdmin = () => useAuth().user?.role === 'admin';
const readOnlyNote = 'Only the admin can change this. Ask them if something needs updating.';

/* ---------- products ---------- */
export function ProductsPage() {
  const admin = useIsAdmin();
  const { data, error, reload } = useApi<{ rows: (Product & { taxName: string | null })[] }>('/products');
  return (
    <>
      <PageHead title="Products" sub={admin ? 'What customers subscribe to. Variants add to the sales price.' : readOnlyNote}
        actions={admin ? <Link className="btn primary" to="/products/new">Add product</Link> : undefined} />
      <section className="panel flush">
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : data.rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty>No products yet. Add the first thing customers can subscribe to.</Empty></div>
        ) : (
          <div className="table-wrap" style={{ paddingTop: 8 }}>
            <table>
              <thead><tr><th>Product</th><th className="hide-sm">Type</th><th className="hide-sm">Variants</th><th className="hide-sm">Tax</th><th className="n">Cost</th><th className="n">Sales price</th></tr></thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id}>
                    <td>{admin ? <Link className="link" to={`/products/${p.id}`}>{p.name}</Link> : p.name}{!p.active ? <span className="sub">no longer sold</span> : p.notes ? <span className="sub truncate">{p.notes}</span> : null}</td>
                    <td className="hide-sm">{p.type === 'goods' ? 'Goods' : 'Service'}</td>
                    <td className="hide-sm">{p.variants.length ? p.variants.map((v) => `${v.value}${v.extraPrice ? ` +${money(v.extraPrice)}` : ''}`).join(' · ') : <span className="muted">—</span>}</td>
                    <td className="hide-sm">{p.taxName ?? <span className="muted">—</span>}</td>
                    <td className="n"><Money value={p.costPrice} /></td>
                    <td className="n"><Money value={p.salesPrice} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

interface VariantDraft { key: number; id?: number; attribute: string; value: string; extra: string }
let vk = 0;

export function ProductFormPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const existing = useApi<Product>(id ? `/products/${id}` : null);
  const { data: taxes } = useApi<{ rows: Tax[] }>('/taxes');
  const [f, setF] = useState({ name: '', type: 'service', salesPrice: '', costPrice: '', notes: '', taxId: '', active: true });
  const [variants, setVariants] = useState<VariantDraft[]>([]);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    const p = existing.data;
    if (!p || loaded) return;
    setF({ name: p.name, type: p.type, salesPrice: toRupeesText(p.salesPrice), costPrice: toRupeesText(p.costPrice), notes: p.notes, taxId: p.taxId ? String(p.taxId) : '', active: p.active });
    setVariants(p.variants.map((v) => ({ key: ++vk, id: v.id, attribute: v.attribute, value: v.value, extra: toRupeesText(v.extraPrice) })));
    setLoaded(true);
  }, [existing.data, loaded]);
  const body = () => ({ name: f.name, type: f.type, salesPrice: toPaise(f.salesPrice), costPrice: toPaise(f.costPrice), notes: f.notes, taxId: f.taxId ? Number(f.taxId) : null, active: f.active,
    variants: variants.map((v) => ({ id: v.id, attribute: v.attribute, value: v.value, extraPrice: toPaise(v.extra) })) });
  const s = useSubmit(async () => (id ? api(`/products/${id}`, { method: 'PUT', body: body() }) : api('/products', { body: body() })), () => nav('/products'));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const margin = toPaise(f.salesPrice) - toPaise(f.costPrice);
  if (!loaded) return <Loading />;
  return (
    <>
      <BackLink to="/products">Products</BackLink>
      <PageHead title={id ? f.name || 'Product' : 'New product'} />
      <form className="cols-2" onSubmit={s.run} noValidate>
        <div className="stack">
          {s.error ? <ErrorNote error={s.error} /> : null}
          <Panel title="Product">
            <div className="form-grid">
              <Field label="Name" error={s.fields.name} wide>{(fid) => <input id={fid} className="input" value={f.name} onChange={set('name')} />}</Field>
              <Field label="Type">{(fid) => <select id={fid} className="input" value={f.type} onChange={set('type')}><option value="service">Service</option><option value="goods">Goods</option></select>}</Field>
              <Field label="Tax">{(fid) => <select id={fid} className="input" value={f.taxId} onChange={set('taxId')}><option value="">No tax</option>{taxes?.rows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}</Field>
              <Field label="Sales price, ₹" error={s.fields.salesPrice} hint="Per billing period of the plan it is sold on">{(fid) => <input id={fid} className="input num" inputMode="decimal" value={f.salesPrice} onChange={set('salesPrice')} />}</Field>
              <Field label="Cost price, ₹" error={s.fields.costPrice}>{(fid) => <input id={fid} className="input num" inputMode="decimal" value={f.costPrice} onChange={set('costPrice')} />}</Field>
              <Field label="Notes" wide>{(fid) => <textarea id={fid} className="input" value={f.notes} onChange={set('notes')} />}</Field>
            </div>
          </Panel>
          <Panel className="flush" title="Variants" meta="Each variant adds its extra price to the sales price">
            {variants.length === 0 ? <div style={{ padding: '0 20px' }}><Empty>No variants. Add one for each brand, region or edition that costs more.</Empty></div> : (
              <div className="table-wrap"><table className="lines-table">
                <thead><tr><th>Attribute</th><th>Value</th><th className="n">Extra price, ₹</th><th className="n">Customer pays</th><th><span className="sr-only">Remove</span></th></tr></thead>
                <tbody>{variants.map((v) => (
                  <tr key={v.key}>
                    <td><input className="input" aria-label="Attribute" placeholder="Brand" value={v.attribute} onChange={(e) => setVariants((vs) => vs.map((x) => x.key === v.key ? { ...x, attribute: e.target.value } : x))} /></td>
                    <td><input className="input" aria-label="Value" placeholder="Odoo" value={v.value} onChange={(e) => setVariants((vs) => vs.map((x) => x.key === v.key ? { ...x, value: e.target.value } : x))} /></td>
                    <td className="price"><input className="input num" style={{ textAlign: 'right' }} aria-label="Extra price" inputMode="decimal" value={v.extra} onChange={(e) => setVariants((vs) => vs.map((x) => x.key === v.key ? { ...x, extra: e.target.value } : x))} /></td>
                    <td className="n"><Money value={toPaise(f.salesPrice) + toPaise(v.extra)} /></td>
                    <td><button type="button" className="btn ghost" onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}>Remove</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
            <div className="panel-foot"><button type="button" className="btn" onClick={() => setVariants((vs) => [...vs, { key: ++vk, attribute: vs.at(-1)?.attribute ?? 'Brand', value: '', extra: '0' }])}>Add a variant</button></div>
          </Panel>
        </div>
        <Panel title="Summary">
          <div className="kv"><div><dt>Margin per unit</dt><dd className={`num${margin < 0 ? ' neg-text' : ''}`}>{money(margin)}</dd></div></div>
          <label className="check-row" style={{ marginTop: 8 }}>
            <span><span className="t">On sale</span><br /><span className="d">Turn off to stop offering it; running subscriptions keep it.</span></span>
            <input type="checkbox" className="switch" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          </label>
          <div className="form-actions"><button className="btn primary" style={{ flex: 1 }} disabled={s.busy}>{id ? 'Save changes' : 'Add product'}</button></div>
        </Panel>
      </form>
    </>
  );
}

/* ---------- plans ---------- */
export function PlansPage() {
  const admin = useIsAdmin();
  const { data, error, reload } = useApi<{ rows: (Plan & { taxName: string | null })[] }>('/plans');
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const today = todayIso();
  return (
    <>
      <PageHead title="Plans" sub={admin ? 'What each subscription costs, how often it bills, and what customers may do with it.' : readOnlyNote}
        actions={admin ? <button className="btn primary" onClick={() => setEditing('new')}>Add plan</button> : undefined} />
      <section className="panel flush">
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : (
          <div className="table-wrap" style={{ paddingTop: 8 }}>
            <table>
              <thead><tr><th>Plan</th><th>Bills</th><th className="n hide-sm">Min. qty</th><th className="hide-sm">Available</th><th className="hide-sm">Customers may</th><th className="n">Active</th><th className="n">Price</th></tr></thead>
              <tbody>
                {data.rows.map((p) => {
                  const ended = (p.endDate && p.endDate < today) || !p.active;
                  return (
                    <tr key={p.id}>
                      <td>{admin ? <button className="link-btn" onClick={() => setEditing(p)}>{p.name}</button> : p.name}{ended ? <span className="sub">closed to new customers</span> : p.taxName ? <span className="sub">{p.taxName}</span> : null}</td>
                      <td>{PERIOD_ADJ[p.period]}{p.autoClose ? <span className="sub">closes at end date</span> : null}</td>
                      <td className="n num hide-sm">{p.minQuantity}</td>
                      <td className="hide-sm num">{p.startDate || p.endDate ? `${p.startDate ? dateWords(p.startDate) : 'Any time'} to ${p.endDate ? dateWords(p.endDate) : 'open'}` : 'Any time'}</td>
                      <td className="hide-sm">{[p.pausable && 'pause', p.closable && 'close early', p.renewable && 'renew'].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                      <td className="n num">{count(p.activeCount ?? 0)}</td>
                      <td className="n"><Money value={p.price} /><span className="sub">per {PERIOD_WORD[p.period]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editing ? <PlanModal plan={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </>
  );
}

function PlanModal({ plan, onClose, onSaved }: { plan?: Plan; onClose: () => void; onSaved: () => void }) {
  const { data: taxes } = useApi<{ rows: Tax[] }>('/taxes');
  const [f, setF] = useState({ name: plan?.name ?? '', price: plan ? toRupeesText(plan.price) : '', period: plan?.period ?? 'monthly', minQuantity: String(plan?.minQuantity ?? 1),
    startDate: plan?.startDate ?? '', endDate: plan?.endDate ?? '', taxId: plan?.taxId ? String(plan.taxId) : '', active: plan?.active ?? true });
  const [rules, setRules] = useState({ autoClose: plan?.autoClose ?? false, closable: plan?.closable ?? true, pausable: plan?.pausable ?? false, renewable: plan?.renewable ?? true });
  const body = () => ({ name: f.name, price: toPaise(f.price), period: f.period, minQuantity: Number(f.minQuantity) || 0, startDate: f.startDate || null, endDate: f.endDate || null,
    taxId: f.taxId ? Number(f.taxId) : null, active: f.active, ...rules });
  const s = useSubmit(() => (plan ? api(`/plans/${plan.id}`, { method: 'PUT', body: body() }) : api('/plans', { body: body() })), onSaved);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const RULES: [keyof typeof rules, string, string][] = [
    ['autoClose', 'Close automatically', 'Ends on its end date and is not billed after it.'],
    ['closable', 'Can be closed early', 'The customer or the team may close it before its end date.'],
    ['pausable', 'Can be paused', 'Billing stops while paused and resumes from the next period.'],
    ['renewable', 'Can be renewed', 'Extends the end date by the original term.'],
  ];
  return (
    <Modal title={plan ? `Edit ${plan.name}` : 'Add a plan'} onClose={onClose} wide>
      <form className="form" onSubmit={s.run} noValidate>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <div className="form-grid three">
          <Field label="Name" error={s.fields.name}>{(id) => <input id={id} className="input" value={f.name} onChange={set('name')} />}</Field>
          <Field label="Price, ₹" error={s.fields.price}>{(id) => <input id={id} className="input num" inputMode="decimal" value={f.price} onChange={set('price')} />}</Field>
          <Field label="Bills every">{(id) => <select id={id} className="input" value={f.period} onChange={set('period')}>{Object.entries(PERIOD_WORD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}</Field>
          <Field label="Minimum quantity" error={s.fields.minQuantity}>{(id) => <input id={id} className="input num" inputMode="numeric" value={f.minQuantity} onChange={set('minQuantity')} />}</Field>
          <Field label="Available from" error={s.fields.startDate}>{(id) => <input id={id} type="date" className="input" value={f.startDate} onChange={set('startDate')} />}</Field>
          <Field label="Available until" error={s.fields.endDate}>{(id) => <input id={id} type="date" className="input" value={f.endDate} onChange={set('endDate')} />}</Field>
          <Field label="Tax on the plan fee">{(id) => <select id={id} className="input" value={f.taxId} onChange={set('taxId')}><option value="">No tax</option>{taxes?.rows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}</Field>
        </div>
        <div>
          {RULES.map(([k, t, d]) => (
            <label key={k} className="check-row"><span><span className="t">{t}</span><br /><span className="d">{d}</span></span>
              <input type="checkbox" className="switch" checked={rules[k]} onChange={(e) => setRules({ ...rules, [k]: e.target.checked })} /></label>
          ))}
          <label className="check-row"><span><span className="t">Offered to new customers</span><br /><span className="d">Turn off to retire it; running subscriptions continue.</span></span>
            <input type="checkbox" className="switch" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /></label>
        </div>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={s.busy}>Save plan</button></div>
      </form>
    </Modal>
  );
}

/* ---------- taxes ---------- */
export function TaxesPage() {
  const admin = useIsAdmin();
  const { data, error, reload } = useApi<{ rows: Tax[] }>('/taxes');
  const [editing, setEditing] = useState<Tax | 'new' | null>(null);
  return (
    <>
      <PageHead title="Taxes" sub={admin ? 'Rates added on top of each invoice line. Products and plans each pick one.' : readOnlyNote}
        actions={admin ? <button className="btn primary" onClick={() => setEditing('new')}>Add tax</button> : undefined} />
      <section className="panel flush" style={{ maxWidth: 760 }}>
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : (
          <div className="table-wrap" style={{ paddingTop: 8 }}><table>
            <thead><tr><th>Name</th><th>In use</th><th className="n">Rate</th></tr></thead>
            <tbody>{data.rows.map((t) => (
              <tr key={t.id}><td>{admin ? <button className="link-btn" onClick={() => setEditing(t)}>{t.name}</button> : t.name}</td><td>{t.active ? 'Yes' : <span className="muted">Retired</span>}</td><td className="n num">{t.rate.toFixed(2)}%</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {editing ? <TaxModal tax={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
    </>
  );
}

function TaxModal({ tax, onClose, onSaved }: { tax?: Tax; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: tax?.name ?? '', rate: tax ? String(tax.rate) : '', active: tax?.active ?? true });
  const body = () => ({ name: f.name, rate: Number(f.rate), active: f.active });
  const s = useSubmit(() => (tax ? api(`/taxes/${tax.id}`, { method: 'PUT', body: body() }) : api('/taxes', { body: body() })), onSaved);
  return (
    <Modal title={tax ? `Edit ${tax.name}` : 'Add a tax'} onClose={onClose}>
      <form className="form" onSubmit={s.run} noValidate>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <div className="form-grid">
          <Field label="Name" error={s.fields.name}>{(id) => <input id={id} className="input" placeholder="GST 18%" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label="Rate, %" error={s.fields.rate}>{(id) => <input id={id} className="input num" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} />}</Field>
        </div>
        <label className="check-row"><span><span className="t">In use</span><br /><span className="d">Retired taxes stay on old invoices.</span></span>
          <input type="checkbox" className="switch" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /></label>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={s.busy}>Save</button></div>
      </form>
    </Modal>
  );
}

/* ---------- discounts ---------- */
interface Discount { id: number; name: string; type: 'fixed' | 'percent'; value: number; minAmount: number; minQuantity: number; startDate: string | null; endDate: string | null;
  usageLimit: number | null; usedCount: number; scope: 'products' | 'subscriptions'; active: boolean; productIds?: number[]; subscriptionIds?: number[] }

const describeValue = (d: Discount) => (d.type === 'percent' ? `${d.value}% off` : `${money(d.value)} off`);

export function DiscountsPage() {
  const admin = useIsAdmin();
  const { data, error, reload } = useApi<{ rows: Discount[] }>('/discounts');
  const today = todayIso();
  const state = (d: Discount) => !d.active ? 'Off' : d.endDate && d.endDate < today ? 'Ended' : d.startDate && d.startDate > today ? 'Scheduled'
    : d.usageLimit !== null && d.usedCount >= d.usageLimit ? 'Used up' : 'Applying';
  return (
    <>
      <PageHead title="Discounts" sub={admin ? 'Rules applied automatically to each new invoice while they are valid.' : readOnlyNote}
        actions={admin ? <Link className="btn primary" to="/discounts/new">Add discount rule</Link> : undefined} />
      <section className="panel flush">
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : data.rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty>No discount rules yet.</Empty></div>
        ) : (
          <div className="table-wrap" style={{ paddingTop: 8 }}><table>
            <thead><tr><th>Rule</th><th>Applies to</th><th className="hide-sm">Condition</th><th className="hide-sm">Valid</th><th>Status</th><th className="n">Used</th></tr></thead>
            <tbody>{data.rows.map((d) => {
              const st = state(d);
              return (
                <tr key={d.id}>
                  <td>{admin ? <Link className="link" to={`/discounts/${d.id}`}>{d.name}</Link> : d.name}<span className="sub">{describeValue(d)}</span></td>
                  <td>{d.scope === 'products' ? 'Chosen products' : 'Whole invoice'}</td>
                  <td className="hide-sm">{[d.minQuantity ? `${d.minQuantity}+ units` : null, d.minAmount ? `${money(d.minAmount)}+ purchase` : null].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                  <td className="hide-sm num">{d.startDate ?? 'Any time'} to {d.endDate ?? 'open'}</td>
                  <td><span className={`pill${st === 'Applying' ? ' pos' : ''}`}>{st}</span></td>
                  <td className="n num">{count(d.usedCount)}{d.usageLimit !== null ? <span className="muted"> / {count(d.usageLimit)}</span> : null}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </section>
    </>
  );
}

export function DiscountFormPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const existing = useApi<Discount>(id ? `/discounts/${id}` : null);
  const { data: products } = useApi<{ rows: Product[] }>('/products');
  const [f, setF] = useState({ name: '', type: 'percent', value: '', minAmount: '', minQuantity: '', startDate: todayIso(), endDate: '', usageLimit: '', scope: 'subscriptions', active: true });
  const [productIds, setProductIds] = useState<number[]>([]);
  const [subs, setSubs] = useState<{ id: number; label: string }[]>([]);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    const d = existing.data;
    if (!d || loaded) return;
    setF({ name: d.name, type: d.type, value: d.type === 'fixed' ? toRupeesText(d.value) : String(d.value), minAmount: d.minAmount ? toRupeesText(d.minAmount) : '',
      minQuantity: d.minQuantity ? String(d.minQuantity) : '', startDate: d.startDate ?? '', endDate: d.endDate ?? '', usageLimit: d.usageLimit ? String(d.usageLimit) : '', scope: d.scope, active: d.active });
    setProductIds(d.productIds ?? []);
    Promise.all((d.subscriptionIds ?? []).map((sid) => api<{ id: number; number: string; customerName: string }>(`/subscriptions/${sid}`)))
      .then((rs) => setSubs(rs.map((r) => ({ id: r.id, label: `${r.number} · ${r.customerName}` }))));
    setLoaded(true);
  }, [existing.data, loaded]);
  const body = () => ({ name: f.name, type: f.type, value: f.type === 'fixed' ? toPaise(f.value) : Math.round(Number(f.value)), minAmount: f.minAmount ? toPaise(f.minAmount) : 0,
    minQuantity: Number(f.minQuantity) || 0, startDate: f.startDate || null, endDate: f.endDate || null, usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
    scope: f.scope, active: f.active, productIds: f.scope === 'products' ? productIds : [], subscriptionIds: f.scope === 'subscriptions' ? subs.map((s) => s.id) : [] });
  const s = useSubmit(() => (id ? api(`/discounts/${id}`, { method: 'PUT', body: body() }) : api('/discounts', { body: body() })), () => nav('/discounts'));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const searchSubs = async (q: string) => (await api<{ rows: { id: number; number: string; customerName: string }[] }>(`/subscriptions${qs({ q })}`)).rows.slice(0, 8)
    .filter((r) => !subs.some((x) => x.id === r.id)).map((r) => ({ id: r.id, label: r.number, sub: r.customerName }));
  if (!loaded) return <Loading />;
  const sample = 100000 * 10;
  const sampleOff = f.type === 'percent' ? Math.round(sample * (Number(f.value) || 0) / 100) : Math.min(sample, toPaise(f.value));
  return (
    <>
      <BackLink to="/discounts">Discounts</BackLink>
      <PageHead title={id ? f.name || 'Discount rule' : 'New discount rule'} />
      <form className="cols-2" onSubmit={s.run} noValidate>
        <div className="stack">
          {s.error ? <ErrorNote error={s.error} /> : null}
          <Panel title="The discount">
            <div className="form-grid">
              <Field label="Name" error={s.fields.name} wide>{(fid) => <input id={fid} className="input" placeholder="Volume, 10+ seats" value={f.name} onChange={set('name')} />}</Field>
              <Field label="Kind">{(fid) => <select id={fid} className="input" value={f.type} onChange={set('type')}><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select>}</Field>
              <Field label={f.type === 'percent' ? 'Percentage off' : 'Amount off, ₹'} error={s.fields.value}>{(fid) => <input id={fid} className="input num" inputMode="decimal" value={f.value} onChange={set('value')} />}</Field>
              <Field label="Minimum purchase, ₹" hint="Before tax; leave empty for none">{(fid) => <input id={fid} className="input num" inputMode="decimal" value={f.minAmount} onChange={set('minAmount')} />}</Field>
              <Field label="Minimum quantity" hint="Units across the matching lines">{(fid) => <input id={fid} className="input num" inputMode="numeric" value={f.minQuantity} onChange={set('minQuantity')} />}</Field>
              <Field label="Starts" error={s.fields.startDate}>{(fid) => <input id={fid} type="date" className="input" value={f.startDate} onChange={set('startDate')} />}</Field>
              <Field label="Ends" error={s.fields.endDate} hint="Leave empty to run until turned off">{(fid) => <input id={fid} type="date" className="input" value={f.endDate} onChange={set('endDate')} />}</Field>
              <Field label="Usage limit" error={s.fields.usageLimit} hint="Invoices it can apply to; empty for no limit">{(fid) => <input id={fid} className="input num" inputMode="numeric" value={f.usageLimit} onChange={set('usageLimit')} />}</Field>
            </div>
          </Panel>
          <Panel title="Applies to">
            <div className="segmented" role="group" aria-label="Applies to" style={{ marginBottom: 16 }}>
              <button type="button" aria-pressed={f.scope === 'subscriptions'} onClick={() => setF({ ...f, scope: 'subscriptions' })}>Whole subscriptions</button>
              <button type="button" aria-pressed={f.scope === 'products'} onClick={() => setF({ ...f, scope: 'products' })}>Specific products</button>
            </div>
            {f.scope === 'products' ? (
              <Field label="Products" error={s.fields.productIds}>{() => (
                <div className="chips">{products?.rows.map((p) => {
                  const on = productIds.includes(p.id);
                  return <button type="button" key={p.id} className="chip" aria-pressed={on} style={on ? { background: 'var(--text)', color: '#fff', borderColor: 'var(--text)', paddingRight: 10 } : { paddingRight: 10 }}
                    onClick={() => setProductIds((ids) => on ? ids.filter((x) => x !== p.id) : [...ids, p.id])}>{p.name}</button>;
                })}</div>
              )}</Field>
            ) : (
              <Field label="Subscriptions" hint={subs.length ? undefined : 'Leave empty to apply to every subscription that qualifies'}>{(fid) => (
                <div className="stack" style={{ gap: 8 }}>
                  {subs.length ? <div className="chips">{subs.map((x) => <span key={x.id} className="chip">{x.label}<button type="button" aria-label={`Remove ${x.label}`} onClick={() => setSubs((ss) => ss.filter((y) => y.id !== x.id))}>×</button></span>)}</div> : null}
                  <Picker id={fid} value={null} onChange={(r) => r && setSubs((ss) => [...ss, { id: r.id, label: `${r.label} · ${r.sub}` }])} search={searchSubs} placeholder="Add by number or customer" />
                </div>
              )}</Field>
            )}
          </Panel>
        </div>
        <Panel title="On an invoice">
          <p className="muted" style={{ marginTop: 0 }}>On a {money(sample)} invoice that qualifies:</p>
          <KeyValuesLite rows={[['Discount', `−${money(sampleOff)}`], ['Customer pays before tax', money(sample - sampleOff)]]} />
          <label className="check-row" style={{ marginTop: 8 }}><span><span className="t">On</span><br /><span className="d">Turn off to stop applying it to new invoices.</span></span>
            <input type="checkbox" className="switch" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /></label>
          <div className="form-actions"><button className="btn primary" style={{ flex: 1 }} disabled={s.busy}>{id ? 'Save rule' : 'Add rule'}</button></div>
        </Panel>
      </form>
    </>
  );
}
function KeyValuesLite({ rows }: { rows: [string, string][] }) {
  return <dl className="kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}</dl>;
}

/* ---------- quotation templates ---------- */
interface Template { id: number; name: string; planId: number; planName: string; period?: string; validityDays: number; paymentTermsDays: number; termMonths: number | null; notes: string; lineCount?: number; published?: boolean; description?: string;
  lines?: { id: number; productId: number; variantId: number | null; quantity: number; productName: string; variantValue: string | null }[] }

export function TemplatesPage() {
  const { data, error, reload } = useApi<{ rows: Template[] }>('/templates');
  const [quoting, setQuoting] = useState<number | null>(null);
  return (
    <>
      <PageHead title="Quotation templates" sub="Start an offer from a ready plan and product lines instead of building it each time."
        actions={<Link className="btn primary" to="/templates/new">New template</Link>} />
      <section className="panel flush">
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : data.rows.length === 0 ? (
          <div style={{ padding: 20 }}><Empty>No templates yet.</Empty></div>
        ) : (
          <div className="table-wrap" style={{ paddingTop: 8 }}><table>
            <thead><tr><th>Template</th><th>Plan</th><th className="n hide-sm">Lines</th><th className="n hide-sm">Valid for</th><th className="n hide-sm">Term</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{data.rows.map((t) => (
              <tr key={t.id}>
                <td><Link className="link" to={`/templates/${t.id}`}>{t.name}</Link>{t.published ? <span className="pill pos" style={{ marginLeft: 6 }}>On sale online</span> : null}{t.notes ? <span className="sub truncate">{t.notes}</span> : null}</td>
                <td>{t.planName}</td><td className="n num hide-sm">{t.lineCount}</td><td className="n num hide-sm">{t.validityDays} days</td>
                <td className="n num hide-sm">{t.termMonths ? `${t.termMonths} months` : <span className="muted">—</span>}</td>
                <td className="n"><button className="btn" onClick={() => setQuoting(t.id)}>Quote a customer</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {quoting ? <QuoteModal templateId={quoting} onClose={() => setQuoting(null)} /> : null}
    </>
  );
}

interface TLine { key: number; productId: string; variantId: string; quantity: string }
let tk = 0;
export function TemplateFormPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const existing = useApi<Template>(id ? `/templates/${id}` : null);
  const { data: plans } = useApi<{ rows: Plan[] }>('/plans');
  const { data: products } = useApi<{ rows: Product[] }>('/products');
  const [f, setF] = useState({ name: '', planId: '', validityDays: '30', paymentTermsDays: '15', termMonths: '', notes: '', description: '', published: false });
  const [lines, setLines] = useState<TLine[]>([{ key: ++tk, productId: '', variantId: '', quantity: '1' }]);
  const [loaded, setLoaded] = useState(!id);
  useEffect(() => {
    const t = existing.data;
    if (!t || loaded) return;
    setF({ name: t.name, planId: String(t.planId), validityDays: String(t.validityDays), paymentTermsDays: String(t.paymentTermsDays), termMonths: t.termMonths ? String(t.termMonths) : '', notes: t.notes, description: t.description ?? '', published: Boolean(t.published) });
    setLines((t.lines ?? []).map((l) => ({ key: ++tk, productId: String(l.productId), variantId: l.variantId ? String(l.variantId) : '', quantity: String(l.quantity) })));
    setLoaded(true);
  }, [existing.data, loaded]);
  const body = () => ({ name: f.name, planId: Number(f.planId) || 0, validityDays: Number(f.validityDays) || 0, paymentTermsDays: Number(f.paymentTermsDays),
    termMonths: f.termMonths ? Number(f.termMonths) : null, notes: f.notes, description: f.description, published: f.published,
    lines: lines.filter((l) => l.productId).map((l) => ({ productId: Number(l.productId), variantId: l.variantId ? Number(l.variantId) : null, quantity: Number(l.quantity) || 0 })) });
  const s = useSubmit(() => (id ? api(`/templates/${id}`, { method: 'PUT', body: body() }) : api('/templates', { body: body() })), () => nav('/templates'));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const plan = plans?.rows.find((p) => String(p.id) === f.planId);
  const product = (pid: string) => products?.rows.find((p) => String(p.id) === pid);
  const lineAmount = (l: TLine) => { const p = product(l.productId); return p ? (p.salesPrice + (p.variants.find((v) => String(v.id) === l.variantId)?.extraPrice ?? 0)) * (Number(l.quantity) || 0) : 0; };
  const total = (plan?.price ?? 0) + lines.reduce((a, l) => a + lineAmount(l), 0);
  if (!loaded) return <Loading />;
  return (
    <>
      <BackLink to="/templates">Quotation templates</BackLink>
      <PageHead title={id ? f.name || 'Template' : 'New quotation template'} />
      <form className="cols-2" onSubmit={s.run} noValidate>
        <div className="stack">
          {s.error ? <ErrorNote error={s.error} /> : null}
          <Panel title="Template">
            <div className="form-grid">
              <Field label="Name" error={s.fields.name} wide>{(fid) => <input id={fid} className="input" placeholder="Growth, 10 seats" value={f.name} onChange={set('name')} />}</Field>
              <Field label="Plan" error={s.fields.planId}>{(fid) => <select id={fid} className="input" value={f.planId} onChange={set('planId')}><option value="">Choose a plan</option>{plans?.rows.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</Field>
              <Field label="Quotation valid for, days" error={s.fields.validityDays}>{(fid) => <input id={fid} className="input num" inputMode="numeric" value={f.validityDays} onChange={set('validityDays')} />}</Field>
              <Field label="Payment terms">{(fid) => <select id={fid} className="input" value={f.paymentTermsDays} onChange={set('paymentTermsDays')}><option value="0">Due on receipt</option><option value="15">15 days</option><option value="30">30 days</option><option value="45">45 days</option></select>}</Field>
              <Field label="Contract length, months" hint="Sets the end date; empty runs until closed">{(fid) => <input id={fid} className="input num" inputMode="numeric" value={f.termMonths} onChange={set('termMonths')} />}</Field>
              <Field label="Notes for the customer" wide>{(fid) => <textarea id={fid} className="input" value={f.notes} onChange={set('notes')} />}</Field>
              <label className="toggle-row wide">
                <span><span className="toggle-label">Sell online</span><span className="hint">Show this package on the public pricing page and in the customer portal, where customers order and pay for it themselves.</span></span>
                <input type="checkbox" className="switch" role="switch" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} />
              </label>
              {f.published ? <Field label="Description on the pricing page" wide>{(fid) => <textarea id={fid} className="input" value={f.description} onChange={set('description')} />}</Field> : null}
            </div>
          </Panel>
          <Panel className="flush" title="Product lines">
            <div className="table-wrap"><table className="lines-table">
              <thead><tr><th>Product</th><th>Variant</th><th className="n">Qty</th><th className="n">Amount</th><th><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>{lines.map((l) => {
                const p = product(l.productId);
                const upd = (patch: Partial<TLine>) => setLines((ls) => ls.map((x) => x.key === l.key ? { ...x, ...patch } : x));
                return (
                  <tr key={l.key}>
                    <td><select className="input" aria-label="Product" value={l.productId} onChange={(e) => upd({ productId: e.target.value, variantId: '' })}><option value="">Choose</option>{products?.rows.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                    <td>{p?.variants.length ? <select className="input" aria-label="Variant" value={l.variantId} onChange={(e) => upd({ variantId: e.target.value })}><option value="">Standard</option>{p.variants.map((v) => <option key={v.id} value={v.id}>{v.attribute}: {v.value}</option>)}</select> : <span className="muted">—</span>}</td>
                    <td className="qty"><input className="input num" style={{ textAlign: 'right' }} aria-label="Quantity" inputMode="numeric" value={l.quantity} onChange={(e) => upd({ quantity: e.target.value.replace(/\D/g, '') })} /></td>
                    <td className="n"><Money value={lineAmount(l)} /></td>
                    <td><button type="button" className="btn ghost" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button></td>
                  </tr>
                );
              })}</tbody>
            </table></div>
            <div className="panel-foot"><button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { key: ++tk, productId: '', variantId: '', quantity: '1' }])}>Add a line</button>
              {s.fields.lines ? <span className="field-error" style={{ marginLeft: 12 }}>{s.fields.lines.join(' ')}</span> : null}</div>
          </Panel>
        </div>
        <Panel title="The offer">
          <KeyValuesLite rows={[['Plan fee', money(plan?.price ?? 0)], ['Products', money(total - (plan?.price ?? 0))], [`Per ${plan ? PERIOD_WORD[plan.period] : 'period'}, before tax`, money(total)]]} />
          <div className="form-actions" style={{ marginTop: 16 }}><button className="btn primary" style={{ flex: 1 }} disabled={s.busy}>{id ? 'Save template' : 'Create template'}</button></div>
        </Panel>
      </form>
    </>
  );
}

/* ---------- team ---------- */
export function TeamPage() {
  const { data, error, reload } = useApi<{ rows: { id: number; name: string; email: string; role: string; active: number; createdAt: string }[] }>('/users');
  const [adding, setAdding] = useState(false);
  const toggle = async (id: number, active: boolean) => { await api(`/users/${id}`, { method: 'PATCH', body: { active } }); reload(); };
  return (
    <>
      <PageHead title="Team" sub="Staff handle customers, subscriptions, invoices and payments. Only you can add them or change the catalogue."
        actions={<button className="btn primary" onClick={() => setAdding(true)}>Add staff member</button>} />
      <section className="panel flush" style={{ maxWidth: 900 }}>
        {error ? <div style={{ padding: 20 }}><ErrorNote error={error} onRetry={reload} /></div> : !data ? <div style={{ padding: 20 }}><Loading /></div> : (
          <div className="table-wrap" style={{ paddingTop: 8 }}><table>
            <thead><tr><th>Name</th><th className="hide-sm">Email</th><th>Role</th><th className="n hide-sm">Added</th><th><span className="sr-only">Access</span></th></tr></thead>
            <tbody>{data.rows.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{!u.active ? <span className="sub">access removed</span> : null}</td><td className="hide-sm">{u.email}</td><td>{u.role === 'admin' ? 'Admin' : 'Staff'}</td>
                <td className="n num hide-sm">{u.createdAt.slice(0, 10)}</td>
                <td className="n">{u.role === 'staff' ? <button className={`btn${u.active ? ' danger' : ''}`} onClick={() => toggle(u.id, !u.active)}>{u.active ? 'Remove access' : 'Restore access'}</button> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
      {adding ? <StaffModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} /> : null}
    </>
  );
}

function StaffModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const s = useSubmit(() => api('/users', { body: f }), onSaved);
  return (
    <Modal title="Add a staff member" onClose={onClose}>
      <form className="form" onSubmit={s.run} noValidate>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <Field label="Name" error={s.fields.name}>{(id) => <input id={id} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
        <Field label="Email" error={s.fields.email}>{(id) => <input id={id} type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
        <Field label="Temporary password" error={s.fields.password} hint="More than eight characters with an uppercase, a lowercase and a special character. They can reset it by email.">
          {(id) => <input id={id} type="password" className="input" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />}</Field>
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={s.busy}>Add staff member</button></div>
      </form>
    </Modal>
  );
}
