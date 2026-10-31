import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './auth';
import { useLiveEvents, useLiveStatus, type LiveEvent } from './live';
import { Icon } from './icons';

/** Event types worth interrupting someone for. Routine bulk work (confirming, sending, reminders) only refreshes screens. */
const STAFF_TOASTS = new Set(['payment.received', 'payment.failed', 'customer.signed_up', 'subscription.created', 'subscription.closed', 'subscription.changed',
  'subscription.activated', 'invoice.credited', 'automation.daily', 'billing.run', 'subscription.renewed']);
const CUSTOMER_TOASTS = new Set(['payment.received', 'invoice.confirmed', 'subscription.activated', 'subscription.closed', 'subscription.renewed', 'invoice.credited',
  'subscription.changed', 'subscription.sent', 'payment.failed']);

interface Toast { key: string; title: string; body: string; to?: string; tone: 'pos' | 'neg' | '' }

function linkFor(e: LiveEvent, portal: boolean) {
  if (!e.entityId) return undefined;
  if (e.entity === 'invoice') return portal ? `/portal/invoices/${e.entityId}` : `/invoices/${e.entityId}`;
  if (e.entity === 'subscription') return portal ? `/portal/subscriptions/${e.entityId}` : `/subscriptions/${e.entityId}`;
  if (e.entity === 'customer' && !portal) return `/customers/${e.entityId}`;
  return undefined;
}

const TITLES: Record<string, string> = {
  'payment.received': 'Payment received', 'payment.failed': 'Payment failed', 'customer.signed_up': 'New customer', 'subscription.created': 'New subscription',
  'subscription.closed': 'Subscription closed', 'subscription.changed': 'Subscription changed', 'subscription.activated': 'Subscription started',
  'invoice.credited': 'Credit note issued', 'automation.daily': 'Daily automation ran', 'billing.run': 'Billing run', 'subscription.renewed': 'Subscription renewed',
  'invoice.confirmed': 'New invoice', 'subscription.sent': 'New quotation',
};

export function Toaster() {
  const { user } = useAuth();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (key: string) => setToasts((t) => t.filter((x) => x.key !== key));
  const onBatch = useCallback((batch: LiveEvent[]) => {
    if (!user) return;
    const portal = user.role === 'customer';
    const wanted = batch.filter((e) => (portal ? CUSTOMER_TOASTS : STAFF_TOASTS).has(e.type) && (portal || e.actorName !== user.name));
    if (!wanted.length) return;
    const fresh: Toast[] = wanted.length > 4
      ? [{ key: `b${wanted[0].id}`, title: `${wanted.length} updates`, body: wanted.slice(-2).map((e) => e.message).join(' '), tone: '' }]
      : wanted.map((e) => ({ key: String(e.id), title: TITLES[e.type] ?? 'Update', body: e.message, to: linkFor(e, portal),
          tone: e.type === 'payment.received' ? 'pos' : e.type === 'payment.failed' || e.type === 'subscription.closed' ? 'neg' : '' }));
    setToasts((t) => [...t, ...fresh].slice(-4));
    for (const f of fresh) setTimeout(() => dismiss(f.key), 7000);
  }, [user]);
  useLiveEvents(onBatch);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.key} className={`toast ${t.tone}`}>
          <div className="toast-text">
            <div className="toast-title">{t.title}</div>
            <div className="toast-body">{t.to ? <Link to={t.to} onClick={() => dismiss(t.key)}>{t.body}</Link> : t.body}</div>
          </div>
          <button className="btn ghost icon" aria-label="Dismiss" onClick={() => dismiss(t.key)}><Icon.close /></button>
        </div>
      ))}
    </div>
  );
}

export function LiveBadge() {
  const s = useLiveStatus();
  const label = s === 'live' ? 'Live' : s === 'off' ? 'Offline' : 'Connecting…';
  return (
    <span className={`live-badge ${s}`} title={s === 'live' ? 'Changes made by anyone appear here within seconds' : 'Trying to reconnect to live updates'}>
      <span className="live-dot" aria-hidden="true" />{label}
    </span>
  );
}
