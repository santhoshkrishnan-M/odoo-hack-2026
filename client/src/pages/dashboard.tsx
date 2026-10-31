import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import { Bars } from '../charts';
import { ActivityList, ErrorNote, Loading, Money, PageHead, Panel, useApi, useQueryState, type ActivityRow } from '../components';
import { ago, useNow } from '../live';
import { addDaysIso, count, dateWords, monthLabel, PERIOD_ADJ, rupees, SUB_STATUS, todayIso } from '../format';

interface Dashboard {
  from: string; to: string; activeSubscriptions: number; mrr: number; revenue: number; paymentCount: number; invoiced: number; invoiceCount: number;
  outstanding: number; openCount: number; overdueCount: number; overdueAmount: number; draftInvoices: number; dueForBilling: number;
  byMonth: { month: string; collected: number; invoiced: number }[]; statusCounts: Record<string, number>;
  byPlan: { id: number; name: string; period: string; active: number; mrr: number }[];
  topOverdue: { id: number; number: string; dueDate: string; balance: number; customerName: string; customerId: number; daysLate: number }[];
  ageing: { key: string; label: string; count: number; amount: number }[];
  arr: number; arpa: number; refunds: number; credited: number; churnRate: number; netNewMrr: number; prevNetNewMrr: number;
  mrrMonths: { month: string; opening: number; new: number; expansion: number; reactivation: number; contraction: number; churn: number; closing: number; churned: number }[];
  lastRun: { finishedAt: string; ok: number; summary: Record<string, number> } | null;
}

const RANGES: Record<string, { label: string; from: (t: string) => string }> = {
  '12m': { label: 'Last 12 months', from: (t) => `${addMonths(t.slice(0, 7), -11)}-01` },
  q: { label: 'This quarter', from: (t) => `${t.slice(0, 5)}${String(Math.floor((Number(t.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01` }, // taste-skill-ignore: a date
  m: { label: 'This month', from: (t) => `${t.slice(0, 7)}-01` },
  ytd: { label: 'Year to date', from: (t) => `${t.slice(0, 4)}-01-01` },
};
function addMonths(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`; // taste-skill-ignore: a year-month, not a counter
}
// Ageing tones step from grey to ink; only the oldest debt takes the negative colour.
const AGE_TONE: Record<string, string> = { current: '#c9ccd1', '1-30': '#8a8f96', '31-60': '#4d5157', '61-90': '#141414', '90+': 'var(--negative)' };
const rupeeAxis = (v: number) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(v % 1e7 ? 1 : 0)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(v % 1e5 ? 1 : 0)} L` : `₹${count(v)}`);

export function DashboardPage() {
  const [params, set] = useQueryState();
  const nav = useNavigate();
  const range = params.get('range') ?? '12m';
  const planId = params.get('planId') ?? '';
  const today = todayIso();
  const from = (RANGES[range] ?? RANGES['12m']).from(today);
  const { data: d, error, reload } = useApi<Dashboard>(`/reports/dashboard${qs({ from, to: today, planId })}`);
  const { data: plans } = useApi<{ rows: { id: number; name: string }[] }>('/plans');
  const [billing, setBilling] = useState<string | null>(null);
  const feed = useApi<{ rows: ActivityRow[] }>('/admin/activity?limit=20');
  const now = useNow();
  const [running, setRunning] = useState(false);

  const chart = useMemo(() => {
    if (!d) return null;
    const months: string[] = [];
    for (let m = from.slice(0, 7); m <= today.slice(0, 7); m = addMonths(m, 1)) months.push(m);
    const byM = Object.fromEntries(d.byMonth.map((r) => [r.month, r]));
    return {
      labels: months.map(monthLabel),
      values: months.map((m) => Math.round((byM[m]?.collected ?? 0) / 100)),
      highlight: months.length - 1,
      annotations: [{ at: months.length - 1, label: `${monthLabel(months.at(-1)!)} to date`, short: 'to date' }],
    };
  }, [d, from, today]);

  const runAutomation = async () => {
    setRunning(true);
    setBilling('Running the daily automation…');
    try {
      const r = await api<{ created: number; closed: number; confirmed: number; sent: number; reminders: number; dunningClosed: number }>('/billing/automation', { body: {} });
      setBilling(`${count(r.created)} invoices created, ${count(r.confirmed)} confirmed, ${count(r.sent)} emailed, ${count(r.reminders)} payment reminders sent` +
        `${r.closed + r.dunningClosed ? `, ${count(r.closed + r.dunningClosed)} subscriptions closed` : ''}.`);
      reload();
    } catch (e) { setBilling((e as Error).message); } finally { setRunning(false); }
  };

  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!d || !chart) return <><PageHead title="Overview" /><Loading /></>;

  const oldest = d.topOverdue[0];
  const finding = d.overdueCount > 0
    ? <>{rupees(d.overdueAmount)} is overdue on {count(d.overdueCount)} invoices{oldest ? <>; the oldest, {oldest.number} for {oldest.customerName}, is {count(oldest.daysLate)} days late.</> : '.'}</>
    : <>Nothing is overdue. {rupees(d.outstanding)} is still to come in on invoices not yet due.</>;
  const collectedShare = d.invoiced ? Math.round((d.revenue / d.invoiced) * 1000) / 10 : null;
  const ageMax = d.ageing.reduce((a, b) => a + b.amount, 0);
  const planMax = Math.max(1, ...d.byPlan.map((p) => p.mrr));

  return (
    <>
      <PageHead title="Overview" sub={finding} actions={<>
        {d.draftInvoices > 0 ? <button className="btn" onClick={() => nav('/invoices?status=draft')}>Review {count(d.draftInvoices)} drafts</button> : null}
        <button className="btn primary" onClick={runAutomation} disabled={running}>{d.dueForBilling > 0 ? `Bill ${count(d.dueForBilling)} due now` : 'Run automation now'}</button>
      </>} />
      <p className="stamp" style={{ margin: '-12px 0 16px' }}>
        {d.lastRun ? <>Automation last ran {ago(d.lastRun.finishedAt, now)}{d.lastRun.ok ? '' : ' and failed'} · </> : 'Automation has not run yet · '}
        billing, confirmation, emails, reminders and renewals run by themselves every day
      </p>
      {billing ? <p className="ok-note" role="status" style={{ marginTop: -8, marginBottom: 12 }}>{billing}</p> : null}
      <div className="filters">
        <div className="segmented" role="group" aria-label="Period">
          {Object.entries(RANGES).map(([k, r]) => <button key={k} aria-pressed={k === range} onClick={() => set({ range: k === '12m' ? null : k })}>{r.label}</button>)}
        </div>
        <select className="input" aria-label="Plan" value={planId} onChange={(e) => set({ planId: e.target.value || null })}>
          <option value="">All plans</option>
          {plans?.rows.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="spacer" />
        <span className="stamp">{dateWords(from)} to {dateWords(today)}</span>
      </div>

      <div className="kpis">
        <div className="kpi lead"><div className="kpi-label">Monthly recurring revenue</div><div className="kpi-value num">{rupees(d.mrr)}</div>
          <div className="delta">{count(d.activeSubscriptions)} active · <span className={d.netNewMrr < 0 ? 'neg-text' : ''}>{d.netNewMrr >= 0 ? '+' : '−'}{rupees(Math.abs(d.netNewMrr))}</span> this month</div></div>
        <div className="kpi"><div className="kpi-label">Collected</div><div className="kpi-value num">{rupees(d.revenue)}</div>
          <div className="delta">{count(d.paymentCount)} payments{collectedShare !== null ? ` · ${collectedShare.toFixed(1)}% of ${rupees(d.invoiced)} invoiced` : ''}</div></div>
        <div className="kpi"><div className="kpi-label">Still owed</div><div className="kpi-value num">{rupees(d.outstanding)}</div>
          <div className="delta">on {count(d.openCount)} confirmed invoices</div></div>
        <div className="kpi"><div className="kpi-label">Overdue</div><div className={`kpi-value num${d.overdueAmount ? ' neg-text' : ' zero'}`}>{rupees(d.overdueAmount)}</div>
          <div className="delta">{count(d.overdueCount)} invoices past their due date</div></div>
      </div>

      <div className="kpis secondary" style={{ marginTop: 'var(--gap)' }}>
        <div className="kpi"><div className="kpi-label">Annual run rate</div><div className="kpi-value num">{rupees(d.arr)}</div><div className="delta">MRR × 12</div></div>
        <div className="kpi"><div className="kpi-label">Average per subscription</div><div className="kpi-value num">{rupees(d.arpa)}</div><div className="delta">per month</div></div>
        <div className="kpi"><div className="kpi-label">Revenue churn this month</div><div className={`kpi-value num${d.churnRate ? '' : ' zero'}`}>{d.churnRate.toFixed(1)}%</div>
          <div className="delta">{count(d.mrrMonths.at(-1)?.churned ?? 0)} subscriptions closed</div></div>
        <div className="kpi"><div className="kpi-label">Credited and refunded</div><div className={`kpi-value num${d.credited ? '' : ' zero'}`}>{rupees(d.credited)}</div>
          <div className="delta">{rupees(d.refunds)} paid back in this period</div></div>
      </div>

      <div className="cols-2" style={{ marginTop: 'var(--gap)', marginBottom: 'var(--gap)' }}>
        <Panel title="MRR movements" meta="per month: new, growth, losses" className="flush">
          <MrrTable months={d.mrrMonths.slice(-6)} />
        </Panel>
        <Panel title="Live activity" meta={<span className="stamp">updates by itself</span>} className="feed-panel">
          <ActivityList rows={feed.data?.rows ?? []} compact empty="Waiting for the first event…" />
        </Panel>
      </div>

      <div className="cols-2" style={{ marginBottom: 'var(--gap)' }}>
        <Panel title="Collected per month" meta="Payments received less refunds, including tax">
          <Bars labels={chart.labels} values={chart.values} highlight={chart.highlight} format={rupeeAxis} annotations={chart.annotations}
            label={`Payments collected per month, ${chart.labels[0]} to ${chart.labels.at(-1)}`} height={262} />
        </Panel>
        <Panel title="What customers owe" meta={<Link className="card-link" to="/invoices?outstanding=1">All unpaid</Link>} className="ageing">
          <div className="kpi-value num" style={{ fontSize: 24, marginTop: 0 }}>{rupees(ageMax)}</div>
          <div className="delta" style={{ marginTop: 2 }}>by how late each invoice is today</div>
          <div className="ageing-bar" role="img" aria-label="Amount owed by days late">
            {d.ageing.filter((a) => a.amount > 0).map((a) => <span key={a.key} style={{ flexGrow: a.amount, background: AGE_TONE[a.key] }} title={`${a.label}: ${rupees(a.amount)}`} />)}
          </div>
          <div className="rows">
            {d.ageing.map((a) => (
              <Link key={a.key} className="row" to={a.key === 'current' ? '/invoices?outstanding=1' : '/invoices?overdue=1'}>
                <span className="swatch" style={{ background: AGE_TONE[a.key] }} />
                <span className="label">{a.label}</span>
                <span className="cnt num">{count(a.count)}</span>
                <span className={`amt num${a.amount === 0 ? ' zero' : ''}`}>{rupees(a.amount)}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <div className="cols-2">
        <Panel className="flush" title="Longest overdue" meta={<Link className="card-link" to="/invoices?overdue=1">View all {count(d.overdueCount)}</Link>}>
          {d.topOverdue.length === 0 ? <div style={{ padding: '0 20px 20px' }}><div className="empty">No invoice is past its due date.</div></div> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Invoice</th><th>Customer</th><th className="n hide-sm">Due</th><th className="n">Days late</th><th className="n">Balance</th><th className="no-print"><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {d.topOverdue.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td><Link className="link mono" to={`/invoices/${r.id}`}>{r.number}</Link></td>
                      <td className="truncate">{r.customerName}</td>
                      <td className="n num hide-sm">{r.dueDate}</td>
                      <td className="n num neg-text">{count(r.daysLate)}</td>
                      <td className="n"><Money value={r.balance} /></td>
                      <td className="n"><Link className="card-link" to={`/invoices/${r.id}?pay=1`}>Record payment</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title="Recurring revenue by plan" meta="per month">
          <div className="rows plan-list">
            {d.byPlan.length === 0 ? <div className="empty">No active subscriptions on this plan.</div> : d.byPlan.map((p, i) => (
              <Link className="row" key={p.id} to={`/subscriptions?status=active&planId=${p.id}`}>
                <div className="name">
                  <div>{p.name}</div>
                  <div className="bar"><i style={{ width: `${(p.mrr / planMax) * 100}%`, background: i === 0 ? 'var(--text)' : 'var(--chart-2)' }} /></div>
                </div>
                <div className="figs"><div className="num">{rupees(p.mrr)}</div><div className="sub muted num" style={{ fontSize: 12 }}>{count(p.active)} active · {PERIOD_ADJ[p.period]?.toLowerCase()}</div></div>
              </Link>
            ))}
          </div>
          <div className="status-strip">
            {['quotation', 'confirmed', 'active', 'paused', 'draft', 'closed'].map((s) => (
              <Link key={s} to={`/subscriptions?status=${s}${planId ? `&planId=${planId}` : ''}`}>
                <div className="muted" style={{ fontSize: 12 }}>{SUB_STATUS[s].label}</div>
                <div className={`v num${(d.statusCounts[s] ?? 0) === 0 ? ' zero' : ''}`}>{count(d.statusCounts[s] ?? 0)}</div>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

function MrrTable({ months }: { months: Dashboard['mrrMonths'] }) {
  const signed = (v: number) => (v === 0 ? <span className="muted">—</span> : <span className={`num${v < 0 ? ' neg-text' : ''}`}>{v > 0 ? '+' : '−'}{rupees(Math.abs(v))}</span>);
  return (
    <div className="table-wrap">
      <table className="mrr-table">
        <thead><tr><th>Month</th><th className="n">New</th><th className="n hide-sm" title="Upgrades minus downgrades and pauses">Changes</th><th className="n">Churn</th><th className="n">Net</th><th className="n">MRR</th></tr></thead>
        <tbody>
          {months.map((m) => {
            const net = m.closing - m.opening;
            return (
              <tr key={m.month}>
                <td>{monthLabel(m.month)} {m.month.slice(2, 4)}</td>
                <td className="n">{signed(m.new + m.reactivation)}</td>
                <td className="n hide-sm">{signed(m.expansion + m.contraction)}</td>
                <td className="n">{signed(m.churn)}</td>
                <td className="n strong">{signed(net)}</td>
                <td className="n num">{rupees(m.closing)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
