import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, ErrorNote, Loading, PageHead, useApi } from '../components';
import { count, money, PERIOD_WORD } from '../format';
import { Mark } from '../icons';

export interface Offer {
  id: number; name: string; description: string; planName: string; period: string; termMonths: number | null; taxRate: number; minQuantity: number;
  items: { name: string; quantity: number; unitPrice: number }[]; planPrice: number; perPeriod: number; perMonth: number;
}

function OfferCard({ o, qty, setQty, action }: { o: Offer; qty?: number; setQty?: (n: number) => void; action: React.ReactNode }) {
  const seats = qty ?? o.items[0]?.quantity ?? 1;
  const first = o.items[0];
  const perPeriod = first ? o.perPeriod + (seats - first.quantity) * first.unitPrice : o.perPeriod;
  return (
    <section className="panel offer">
      <div className="offer-name">{o.name}</div>
      <div className="offer-price"><span className="num">{money(perPeriod)}</span><span className="muted"> / {PERIOD_WORD[o.period]}</span></div>
      <div className="muted" style={{ fontSize: 12 }}>plus {o.taxRate}% GST · {o.termMonths ? `${o.termMonths}-month term` : 'cancel any time'}</div>
      {o.description ? <p className="offer-desc">{o.description}</p> : null}
      <ul className="offer-items">
        <li>{o.planName} plan fee · {money(o.planPrice)}</li>
        {o.items.map((i, k) => <li key={i.name}>{k === 0 && setQty ? count(seats) : count(i.quantity)} × {i.name} · {money(i.unitPrice)} each</li>)}
      </ul>
      {setQty && first ? (
        <div className="stepper" style={{ margin: '4px 0 16px' }} aria-label="Seats">
          <button type="button" className="btn" aria-label="One fewer" onClick={() => setQty(Math.max(o.minQuantity, seats - 1))}>−</button>
          <span className="num" style={{ minWidth: 72, textAlign: 'center' }}>{count(seats)} {first.name.split(' ').slice(-1)[0].toLowerCase()}{seats === 1 ? '' : 's'}</span>
          <button type="button" className="btn" aria-label="One more" onClick={() => setQty(seats + 1)}>+</button>
        </div>
      ) : null}
      <div style={{ marginTop: 'auto' }}>{action}</div>
    </section>
  );
}

/** Public pricing page: anyone can see the offers; ordering needs an account. */
export function PublicPlans() {
  const { data, error } = useApi<{ rows: Offer[] }>('/public/offers', { live: false });
  const { user } = useAuth();
  return (
    <div className="public">
      <header className="public-head">
        <Link to="/" className="brand-sm"><Mark size={22} /> <strong>Brightloop</strong></Link>
        <nav>{user ? <Link className="btn" to={user.role === 'customer' ? '/portal' : '/'}>Open your account</Link> : <><Link className="btn ghost" to="/login">Sign in</Link><Link className="btn primary" to="/signup?next=/portal/plans">Create an account</Link></>}</nav>
      </header>
      <main className="public-main">
        <h1>Plans and pricing</h1>
        <p className="muted" style={{ maxWidth: 560 }}>Pick a plan, pay the first invoice online by UPI or card, and it starts straight away. Invoices arrive by email each period; pause, upgrade or cancel from your account.</p>
        {error ? <ErrorNote error={error} /> : !data ? <Loading /> : data.rows.length === 0 ? <Empty>No plans are on sale right now.</Empty> : (
          <div className="offers">
            {data.rows.map((o) => <OfferCard key={o.id} o={o} action={<Link className="btn primary block" to={user?.role === 'customer' ? '/portal/plans' : `/signup?next=/portal/plans`}>Choose {o.name}</Link>} />)}
          </div>
        )}
      </main>
    </div>
  );
}

/** Portal: order a published offer; the first invoice opens for payment. */
export function PortalPlans() {
  const { data, error } = useApi<{ rows: Offer[] }>('/portal/offers', { live: false });
  const [qty, setQty] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();
  const order = async (o: Offer) => {
    setBusy(o.id); setErr(null);
    try {
      const r = await api<{ subscriptionId: number; invoiceId: number; total: number }>(`/portal/offers/${o.id}/order`, { body: { quantity: qty[o.id] ?? null } });
      nav(r.total > 0 ? `/portal/invoices/${r.invoiceId}?pay=1` : `/portal/subscriptions/${r.subscriptionId}`);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <>
      <PageHead title="Browse plans" sub="Order a plan yourself: the first invoice is created now and the subscription starts as soon as it is paid." />
      {err ? <ErrorNote error={err} /> : null}
      {error ? <ErrorNote error={error} /> : !data ? <Loading /> : data.rows.length === 0 ? <Empty>No plans are on sale right now.</Empty> : (
        <div className="offers">
          {data.rows.map((o) => <OfferCard key={o.id} o={o} qty={qty[o.id]} setQty={(n) => setQty({ ...qty, [o.id]: n })}
            action={<button className="btn primary block" disabled={busy !== null} onClick={() => order(o)}>{busy === o.id ? 'Creating your order…' : 'Order and pay'}</button>} />)}
        </div>
      )}
    </>
  );
}
