import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from './api';
import { count, INV_STATUS, money, SUB_STATUS } from './format';
import { Icon } from './icons';
import { ago, useLiveVersion, useNow } from './live';

/* ---------- data loading ---------- */
/**
 * Loads `path` and keeps it current: whenever the live stream reports a change, the data is fetched again
 * in the background (no spinner, no layout jump). Pass `{ live: false }` for one-off reads.
 */
export function useApi<T>(path: string | null, opts: { live?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const liveVersion = useLiveVersion();
  const follow = opts.live !== false;
  const first = useRef(true);
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, tick]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!path || !follow) return;
    let live = true;
    api<T>(path).then((d) => { if (live) { setData(d); setError(null); } }).catch(() => undefined);
    return () => { live = false; };
  }, [liveVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

/* ---------- activity ---------- */
export interface ActivityRow { id?: number; createdAt: string; message: string; type: string; actorName?: string }
export function ActivityList({ rows, empty = 'Nothing has happened here yet.', compact }: { rows: ActivityRow[]; empty?: string; compact?: boolean }) {
  const now = useNow();
  if (!rows.length) return <div className="empty">{empty}</div>;
  return (
    <ol className={`activity${compact ? ' compact' : ''}`}>
      {rows.map((r, i) => (
        <li key={`${r.id ?? i}-${r.createdAt}`} className={`act act-${r.type.split('.')[0]}`}>
          <span className="act-dot" aria-hidden="true" />
          <div className="act-body">
            <div className="act-msg">{r.message}</div>
            <div className="act-meta"><time dateTime={r.createdAt} title={new Date(r.createdAt).toLocaleString('en-IN')}>{ago(r.createdAt, now)}</time>
              {r.actorName ? <> · {r.actorName}</> : null}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ExportLink({ what, query }: { what: 'invoices' | 'subscriptions' | 'payments'; query: Record<string, string | number | null | undefined> }) {
  const params = { ...query };
  delete params.page;
  return <a className="btn" href={`/api/reports/export/${what}${qs(params)}`} download>Export CSV</a>;
}

/** Query-string state for list screens, so filters survive reloads and links. */
export function useQueryState(): [URLSearchParams, (patch: Record<string, string | null>) => void] {
  const [params, setParams] = useSearchParams();
  const set = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v === null || v === '' ? next.delete(k) : next.set(k, v));
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  }, [params, setParams]);
  return [params, set];
}

/* ---------- layout pieces ---------- */
export function PageHead({ title, sub, actions, pill }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; pill?: ReactNode }) {
  return (
    <div className="title-row">
      <div>
        <h1>{title}{pill ? <span className="title-pill">{pill}</span> : null}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, meta, children, className = '', span }: { title?: ReactNode; meta?: ReactNode; children: ReactNode; className?: string; span?: number }) {
  return (
    <section className={`panel ${className}`} style={span ? { gridColumn: `span ${span}` } : undefined}>
      {title || meta ? <header>{title ? <h2>{title}</h2> : <span />}{meta ? <div className="meta">{meta}</div> : null}</header> : null}
      {children}
    </section>
  );
}

export function SubStatus({ status }: { status: string }) {
  const s = SUB_STATUS[status] ?? { label: status, tone: '' };
  return <span className={`pill ${s.tone}`}>{s.label}</span>;
}
export function InvStatus({ status, overdue, kind }: { status: string; overdue?: boolean | number; kind?: string }) {
  if (kind === 'credit_note') return <span className="pill">{status === 'paid' ? 'Credit applied' : status === 'cancelled' ? 'Cancelled' : 'Credit note'}</span>;
  if (overdue) return <span className="pill neg">Overdue</span>;
  const s = INV_STATUS[status] ?? { label: status, tone: '' };
  return <span className={`pill ${s.tone}`}>{s.label}</span>;
}

export function Money({ value, strong }: { value: number | null | undefined; strong?: boolean }) {
  const zero = value === 0;
  return <span className={`num${zero ? ' zero' : ''}${strong ? ' strong' : ''}`}>{money(value)}</span>;
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const last = Math.ceil(total / pageSize);
  return (
    <div className="pager">
      <span className="num">{count(from)}–{count(to)} of {count(total)}</span>
      <div>
        <button className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn" disabled={page >= last} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="error-note" role="alert">
      <span>{error}</span>
      {onRetry ? <button className="btn ghost" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="loading" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: 20, margin: '12px 0', width: `${90 - (i % 3) * 15}%` }} />)}
    </div>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ? (
        <div className="empty-icon">{icon}</div>
      ) : (
        <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      )}
      <div>{children}</div>
    </div>
  );
}

/* ---------- forms ---------- */
export function Field({ label, error, hint, children, wide }: { label: string; error?: string[] | string; hint?: ReactNode; children: (id: string) => ReactNode; wide?: boolean }) {
  const id = useId();
  const msg = Array.isArray(error) ? error.join(' ') : error;
  return (
    <div className={`field${wide ? ' wide' : ''}${msg ? ' has-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {msg ? <span className="field-error" id={`${id}-err`}>{msg}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function useSubmit<T>(fn: () => Promise<T>, onDone?: (r: T) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const run = async (e?: { preventDefault(): void }) => {
    e?.preventDefault();
    setBusy(true); setError(null); setFields({});
    try {
      const r = await fn();
      onDone?.(r);
    } catch (err) {
      if (err instanceof ApiError) { setError(err.message); setFields(err.fields); }
      else setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, fields, setError };
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    // React StrictMode (dev) unmounts and remounts once: the cleanup's close() then fires a late 'close' event while the
    // dialog is already open again. Only treat the event as a real close when the dialog is actually closed.
    <dialog ref={ref} className={`modal${wide ? ' wide' : ''}`} onClose={() => { if (!ref.current?.open) onClose(); }} aria-label={title}>
      <header>
        <h2>{title}</h2>
        <button className="btn ghost icon" onClick={onClose} aria-label="Close"><Icon.close /></button>
      </header>
      {children}
    </dialog>
  );
}

/* ---------- search picker (customers, subscriptions) ---------- */
interface PickRow { id: number; label: string; sub?: string }
export function Picker({ id, value, onChange, search, placeholder }: {
  id: string; value: PickRow | null; onChange: (r: PickRow | null) => void; search: (q: string) => Promise<PickRow[]>; placeholder: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PickRow[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { search(q).then((r) => { setRows(r); setActive(0); }).catch(() => setRows([])); }, 150);
    return () => clearTimeout(t);
  }, [q, open, search]);
  if (value) {
    return (
      <div className="picked">
        <span><strong>{value.label}</strong>{value.sub ? <span className="sub"> · {value.sub}</span> : null}</span>
        <button type="button" className="btn ghost" onClick={() => { onChange(null); setQ(''); }}>Change</button>
      </div>
    );
  }
  const choose = (r: PickRow) => { onChange(r); setOpen(false); };
  return (
    <div className="picker">
      <input id={id} className="input" placeholder={placeholder} value={q} autoComplete="off" role="combobox" aria-expanded={open} aria-controls={`${id}-list`}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && rows[active]) { e.preventDefault(); choose(rows[active]); }
        }} />
      {open && rows.length > 0 ? (
        <ul className="picker-list" id={`${id}-list`} role="listbox">
          {rows.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); choose(r); }}>
              <span>{r.label}</span>{r.sub ? <span className="sub">{r.sub}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export const searchCustomers = async (q: string) =>
  (await api<{ rows: { id: number; name: string; email: string; company: string }[] }>(`/customers${qs({ q })}`)).rows.slice(0, 8)
    .map((c) => ({ id: c.id, label: c.name, sub: c.company || c.email }));

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="back" to={to}>← {children}</Link>;
}

/* ---------- small helpers ---------- */
export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v ?? '—'}</dd></div>
      ))}
    </dl>
  );
}
