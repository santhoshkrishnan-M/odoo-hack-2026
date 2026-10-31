import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { homeFor, useAuth, type User } from '../auth';
import { Field, useApi, useSubmit, ErrorNote } from '../components';
import { Mark } from '../icons';

const RULES: [string, (p: string) => boolean][] = [
  ['More than eight characters', (p) => p.length > 8],
  ['An uppercase letter', (p) => /[A-Z]/.test(p)],
  ['A lowercase letter', (p) => /[a-z]/.test(p)],
  ['A special character, such as ! or #', (p) => /[^A-Za-z0-9]/.test(p)],
];

function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="rules" aria-label="Password rules">
      {RULES.map(([label, ok]) => <li key={label} className={ok(value) ? 'ok' : ''}>{label}</li>)}
    </ul>
  );
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="brand"><Mark /><div><div className="brand-name">Brightloop</div><div className="brand-scope">Subscriptions and billing</div></div></div>
        <div>
          <p className="muted" style={{ maxWidth: 420, marginBottom: 16 }}>Every plan, renewal, invoice and payment in one ledger, so billing day runs itself.</p>
          <div className="ledger rows">
            <div className="row"><span>Renewals</span><span className="muted">billed on their date, never twice</span></div>
            <div className="row"><span>Invoices</span><span className="muted">built from the subscription, taxes included</span></div>
            <div className="row"><span>Payments</span><span className="muted">matched to the invoice they settle</span></div>
            <div className="row"><span>Customers</span><span className="muted">see their own plans and bills</span></div>
          </div>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Brightloop Software</span>
      </aside>
      <main className="auth-main">{children}</main>
    </div>
  );
}

export function Login() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const s = useSubmit(() => api<{ user: User }>('/auth/login', { body: { email, password } }), ({ user: u }) => {
    setUser(u);
    nav(params.get('next') && u.role !== 'customer' ? params.get('next')! : homeFor(u), { replace: true });
  });
  if (user) return <Navigate to={homeFor(user)} replace />;
  const fill = (e: string, p: string) => { setEmail(e); setPassword(p); };
  return (
    <AuthFrame>
      <form className="auth-card" onSubmit={s.run} noValidate>
        <div><h1>Sign in</h1><p className="sub">Use the email you registered with.</p></div>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <Field label="Email" error={s.fields.email}>{(id) => <input id={id} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />}</Field>
        <Field label="Password" error={s.fields.password}>{(id) => <input id={id} className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8 }}><Link to="/forgot-password" className="muted">Forgot password?</Link></div>
        <button className="btn primary" disabled={s.busy}>{s.busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted" style={{ margin: 0 }}>New customer? <Link to="/signup" style={{ color: 'var(--text)', fontWeight: 500 }}>Create an account</Link> or <Link to="/pricing" style={{ color: 'var(--text)', fontWeight: 500 }}>see plans and pricing</Link></p>
        <div className="demo-logins">
          Demo accounts:{' '}
          <button type="button" onClick={() => fill('admin@brightloop.test', 'Admin!pass1')}>admin</button>,{' '}
          <button type="button" onClick={() => fill('staff@brightloop.test', 'Staff!pass1')}>staff</button>,{' '}
          <button type="button" onClick={() => fill('customer@brightloop.test', 'Customer!1')}>customer</button>
        </div>
      </form>
    </AuthFrame>
  );
}

export function Signup() {
  const { user, setUser } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next')?.startsWith('/portal') ? params.get('next')! : '/portal';
  const [f, setF] = useState({ name: '', company: '', email: '', password: '' });
  const s = useSubmit(() => api<{ user: User }>('/auth/signup', { body: f }), ({ user: u }) => { setUser(u); nav(next, { replace: true }); });
  if (user) return <Navigate to={homeFor(user)} replace />;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthFrame>
      <form className="auth-card" onSubmit={s.run} noValidate>
        <div><h1>Create your account</h1><p className="sub">See your subscriptions and invoices, and manage them yourself.</p></div>
        {s.error ? <ErrorNote error={s.error} /> : null}
        <Field label="Your name" error={s.fields.name}>{(id) => <input id={id} className="input" autoComplete="name" value={f.name} onChange={set('name')} />}</Field>
        <Field label="Company" hint="Optional">{(id) => <input id={id} className="input" autoComplete="organization" value={f.company} onChange={set('company')} />}</Field>
        <Field label="Email" error={s.fields.email}>{(id) => <input id={id} className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} />}</Field>
        <Field label="Password" error={s.fields.password}>{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} aria-describedby={`${id}-rules`} />}</Field>
        <PasswordRules value={f.password} />
        <button className="btn primary" disabled={s.busy}>{s.busy ? 'Creating account…' : 'Create account'}</button>
        <p className="muted" style={{ margin: 0 }}>Already registered? <Link to="/login" style={{ color: 'var(--text)', fontWeight: 500 }}>Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}

export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const s = useSubmit(() => api<{ message: string }>('/auth/forgot', { body: { email } }), (r) => setSent(r.message));
  return (
    <AuthFrame>
      <form className="auth-card" onSubmit={s.run} noValidate>
        <div><h1>Reset your password</h1><p className="sub">We will email a link to your registered address. It works once, within 60 minutes.</p></div>
        {s.error ? <ErrorNote error={s.error} /> : null}
        {sent ? <div className="ok-note" role="status">{sent} {import.meta.env.DEV ? <Link to="/mailbox" style={{ textDecoration: 'underline' }}>Open the demo mailbox</Link> : null}</div> : null}
        <Field label="Email" error={s.fields.email}>{(id) => <input id={id} className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <button className="btn primary" disabled={s.busy}>{s.busy ? 'Sending…' : 'Send reset link'}</button>
        <Link to="/login" className="muted">← Back to sign in</Link>
      </form>
    </AuthFrame>
  );
}

export function Reset() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const s = useSubmit(() => api('/auth/reset', { body: { token, password } }), () => setDone(true));
  return (
    <AuthFrame>
      <form className="auth-card" onSubmit={s.run} noValidate>
        <div><h1>Choose a new password</h1><p className="sub">Signing in elsewhere will end once you save it.</p></div>
        {!token ? <ErrorNote error="This link is missing its token. Ask for a new reset link." /> : null}
        {s.error ? <ErrorNote error={s.error} /> : null}
        {done ? <div className="ok-note" role="status">Password changed. <Link to="/login" style={{ textDecoration: 'underline' }}>Sign in</Link></div> : (
          <>
            <Field label="New password" error={s.fields.password}>{(id) => <input id={id} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
            <PasswordRules value={password} />
            <button className="btn primary" disabled={s.busy || !token}>{s.busy ? 'Saving…' : 'Save password'}</button>
          </>
        )}
      </form>
    </AuthFrame>
  );
}

export function Mailbox() {
  const { data, error } = useApi<{ rows: { id: number; toEmail: string; subject: string; body: string; createdAt: string }[] }>('/dev/outbox');
  const linkify = useMemo(() => (body: string) => body.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? <a key={i} href={part.replace(/^https?:\/\/[^/]+/, '')} style={{ textDecoration: 'underline' }}>{part}</a> : part), []);
  return (
    <main className="canvas" style={{ margin: '0 auto', maxWidth: 860 }}>
      <div className="title-row"><div><h1>Demo mailbox</h1><p className="sub">Emails the app sends (password resets, invoices) land here, since no mail service is connected.</p></div>
        <div className="actions"><Link className="btn" to="/login">Sign in</Link></div></div>
      {error ? <ErrorNote error={error} /> : null}
      <div className="stack">
        {data?.rows.length === 0 ? <div className="empty">No emails yet. Ask for a password reset to see one.</div> : null}
        {data?.rows.map((m) => (
          <section className="panel" key={m.id}>
            <header><h2>{m.subject}</h2><span className="meta">to {m.toEmail} · {m.createdAt} UTC</span></header>
            <pre className="mail">{linkify(m.body)}</pre>
          </section>
        ))}
      </div>
    </main>
  );
}
