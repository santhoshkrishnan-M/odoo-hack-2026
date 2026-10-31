import type { DB } from '../db/connection';
import { addPeriods, today } from '../domain/periods';

/** Monthly value of a subscription's recurring charge, in paise, per billing period. */
const MONTHLY = `CASE p.period WHEN 'daily' THEN 365.0/12 WHEN 'weekly' THEN 52.0/12 WHEN 'monthly' THEN 1.0 ELSE 1.0/12 END`;
const LINE_SUM = `LEFT JOIN (SELECT subscription_id, sum(quantity * unit_price) AS amount FROM subscription_lines GROUP BY subscription_id) l ON l.subscription_id = s.id`;

export async function dashboard(db: DB, f: { from: string; to: string; planId?: number }) {
  const t = today();
  const planSub = f.planId ? 'AND s.plan_id = ?' : '';
  const pa = f.planId ? [f.planId] : [];
  const one = async <T>(sql: string, args: unknown[]) => (await db.query<T>(sql, args))[0];

  const [active, revenue, refunds, invoiced, credited, open, drafts, byMonthPaid, byMonthInvoiced, statusRows, byPlan, topOverdue, ageRows, dueForBilling, movements, startMrr, lastRun] = await Promise.all([
    one<{ n: number; mrr: number }>(`SELECT count(*) AS n, coalesce(round(sum((p.price + coalesce(l.amount, 0)) * ${MONTHLY})), 0) AS mrr
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id ${LINE_SUM} WHERE s.status = 'active' ${planSub}`, pa),
    one<{ v: number; n: number }>(`SELECT coalesce(sum(pay.amount), 0) AS v, count(*) AS n FROM payments pay JOIN invoices i ON i.id = pay.invoice_id
      JOIN subscriptions s ON s.id = i.subscription_id WHERE pay.kind = 'payment' AND pay.method <> 'credit_note' AND pay.date BETWEEN ? AND ? ${planSub}`, [f.from, f.to, ...pa]),
    one<{ v: number }>(`SELECT coalesce(sum(pay.amount), 0) AS v FROM payments pay JOIN invoices i ON i.id = pay.invoice_id
      JOIN subscriptions s ON s.id = i.subscription_id WHERE pay.kind = 'refund' AND pay.date BETWEEN ? AND ? ${planSub}`, [f.from, f.to, ...pa]),
    one<{ v: number; n: number }>(`SELECT coalesce(sum(i.total), 0) AS v, count(*) AS n FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.kind <> 'credit_note' AND i.status IN ('confirmed','paid') AND i.invoice_date BETWEEN ? AND ? ${planSub}`, [f.from, f.to, ...pa]),
    one<{ v: number }>(`SELECT coalesce(sum(i.total), 0) AS v FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.kind = 'credit_note' AND i.status IN ('confirmed','paid') AND i.invoice_date BETWEEN ? AND ? ${planSub}`, [f.from, f.to, ...pa]),
    one<{ outstanding: number; openCount: number; overdueAmount: number; overdueCount: number }>(`SELECT coalesce(sum(i.total - i.amount_paid), 0) AS outstanding, count(*) AS "openCount",
        coalesce(sum(i.total - i.amount_paid) FILTER (WHERE i.due_date < ?), 0) AS "overdueAmount",
        count(*) FILTER (WHERE i.due_date < ?) AS "overdueCount"
      FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE i.status = 'confirmed' AND i.kind <> 'credit_note' ${planSub}`, [t, t, ...pa]),
    one<{ n: number }>(`SELECT count(*) AS n FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE i.status = 'draft' ${planSub}`, pa),
    db.query<{ month: string; amount: number }>(`SELECT to_char(pay.date, 'YYYY-MM') AS month, sum(CASE WHEN pay.kind = 'refund' THEN -pay.amount ELSE pay.amount END) AS amount
      FROM payments pay JOIN invoices i ON i.id = pay.invoice_id
      JOIN subscriptions s ON s.id = i.subscription_id WHERE pay.method <> 'credit_note' AND pay.date BETWEEN ? AND ? ${planSub} GROUP BY 1 ORDER BY 1`, [f.from, f.to, ...pa]),
    db.query<{ month: string; amount: number }>(`SELECT to_char(i.invoice_date, 'YYYY-MM') AS month, sum(CASE WHEN i.kind = 'credit_note' THEN -i.total ELSE i.total END) AS amount
      FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.status IN ('confirmed','paid') AND i.invoice_date BETWEEN ? AND ? ${planSub} GROUP BY 1 ORDER BY 1`, [f.from, f.to, ...pa]),
    db.query<{ status: string; n: number }>(`SELECT s.status, count(*) AS n FROM subscriptions s WHERE 1 = 1 ${planSub} GROUP BY s.status`, pa),
    db.query(`SELECT p.id, p.name, p.period, count(*) AS active, round(sum((p.price + coalesce(l.amount, 0)) * ${MONTHLY})) AS mrr
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id ${LINE_SUM} WHERE s.status = 'active' ${planSub} GROUP BY p.id ORDER BY mrr DESC`, pa),
    db.query(`SELECT i.id, i.number, i.due_date AS "dueDate", i.total - i.amount_paid AS balance, c.name AS "customerName", c.id AS "customerId",
        (?::date - i.due_date) AS "daysLate", i.reminder_count AS "reminders"
      FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN subscriptions s ON s.id = i.subscription_id
      WHERE i.status = 'confirmed' AND i.kind <> 'credit_note' AND i.due_date < ? ${planSub} ORDER BY i.due_date LIMIT 8`, [t, t, ...pa]),
    db.query<{ key: string; count: number; amount: number }>(`SELECT CASE
          WHEN i.due_date >= ?::date THEN 'current'
          WHEN ?::date - i.due_date <= 30 THEN '1-30'
          WHEN ?::date - i.due_date <= 60 THEN '31-60'
          WHEN ?::date - i.due_date <= 90 THEN '61-90'
          ELSE '90+' END AS key, count(*) AS count, sum(i.total - i.amount_paid) AS amount
      FROM invoices i JOIN subscriptions s ON s.id = i.subscription_id WHERE i.status = 'confirmed' AND i.kind <> 'credit_note' ${planSub} GROUP BY 1`, [t, t, t, t, ...pa]),
    one<{ n: number }>(`SELECT count(*) AS n FROM subscriptions s WHERE s.status = 'active' AND s.next_invoice_date <= ?
      AND (s.expiry_date IS NULL OR s.next_invoice_date < s.expiry_date) ${planSub}`, [t, ...pa]),
    db.query<{ month: string; kind: string; delta: number; n: number }>(`SELECT to_char(m.date, 'YYYY-MM') AS month, m.kind, sum(m.delta) AS delta, count(*) AS n
      FROM mrr_events m JOIN subscriptions s ON s.id = m.subscription_id WHERE m.date BETWEEN ? AND ? ${planSub} GROUP BY 1, 2 ORDER BY 1`, [f.from, f.to, ...pa]),
    one<{ v: number; n: number }>(`SELECT coalesce(sum(m.delta), 0) AS v FROM mrr_events m JOIN subscriptions s ON s.id = m.subscription_id WHERE m.date < ? ${planSub}`, [f.from, ...pa]),
    one<{ job: string; finishedAt: string; ok: number; summary: Record<string, unknown> } | undefined>(
      `SELECT job, finished_at AS "finishedAt", ok, summary FROM job_runs WHERE job = 'daily' AND finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`, []),
  ]);

  const months = [...new Set([...byMonthPaid, ...byMonthInvoiced].map((r) => r.month))].sort();
  const byMonth = months.map((m) => ({
    month: m,
    collected: byMonthPaid.find((r) => r.month === m)?.amount ?? 0,
    invoiced: byMonthInvoiced.find((r) => r.month === m)?.amount ?? 0,
  }));
  const statusCounts = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));
  const AGE_LABELS: Record<string, string> = { current: 'Not yet due', '1-30': '1–30 days late', '31-60': '31–60 days late', '61-90': '61–90 days late', '90+': '90+ days late' };
  const ageing = Object.keys(AGE_LABELS).map((key) => {
    const r = ageRows.find((x) => x.key === key);
    return { key, label: AGE_LABELS[key], count: r?.count ?? 0, amount: r?.amount ?? 0 };
  });

  // MRR bridge per month: opening + new + expansion + reactivation − contraction − churn = closing.
  const mrrMonths: { month: string; opening: number; new: number; expansion: number; reactivation: number; contraction: number; churn: number; closing: number; churned: number }[] = [];
  let running = startMrr.v;
  for (let m = f.from.slice(0, 7); m <= f.to.slice(0, 7); m = addPeriods(`${m}-01`, 'monthly', 1).slice(0, 7)) {
    const rows = movements.filter((x) => x.month === m);
    const get = (k: string) => rows.find((x) => x.kind === k)?.delta ?? 0;
    const row = { month: m, opening: running, new: get('new'), expansion: get('expansion'), reactivation: get('reactivation'),
      contraction: get('contraction'), churn: get('churn'), closing: 0, churned: rows.find((x) => x.kind === 'churn')?.n ?? 0 };
    row.closing = row.opening + row.new + row.expansion + row.reactivation + row.contraction + row.churn;
    running = row.closing;
    mrrMonths.push(row);
  }
  const last = mrrMonths[mrrMonths.length - 1];
  const prev = mrrMonths[mrrMonths.length - 2];
  const churnRate = last && last.opening > 0 ? Math.round((-last.churn / last.opening) * 10000) / 100 : 0;
  const netNewMrr = last ? last.closing - last.opening : 0;

  return {
    from: f.from, to: f.to, asOf: t,
    activeSubscriptions: active.n, mrr: active.mrr, arr: active.mrr * 12, arpa: active.n ? Math.round(active.mrr / active.n) : 0,
    revenue: revenue.v - refunds.v, refunds: refunds.v, paymentCount: revenue.n, invoiced: invoiced.v - credited.v, credited: credited.v, invoiceCount: invoiced.n,
    outstanding: open.outstanding, openCount: open.openCount, overdueCount: open.overdueCount, overdueAmount: open.overdueAmount,
    draftInvoices: drafts.n, dueForBilling: dueForBilling.n,
    byMonth, statusCounts, byPlan, topOverdue, ageing,
    mrrMonths, churnRate, netNewMrr, prevNetNewMrr: prev ? prev.closing - prev.opening : 0,
    lastRun: lastRun ?? null,
  };
}
