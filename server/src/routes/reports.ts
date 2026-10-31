import { Router, type Response } from 'express';
import { z } from 'zod';
import { validate, isoDate, notFound } from '../http';
import { requireRole } from '../middleware/auth';
import { dashboard } from '../services/reports';
import { addPeriods, today } from '../domain/periods';
import { invoiceFilters, INVOICE_LIST_SQL } from './invoices';
import { subscriptionFilters, SUB_LIST_SQL } from './subscriptions';
import { paymentFilters, PAYMENT_FROM, PAYMENT_COLS } from './payments';

const router = Router();
router.use(requireRole('admin', 'staff'));

router.get('/dashboard', async (req, res) => {
  const q = validate(z.object({ from: isoDate.optional(), to: isoDate.optional(), planId: z.coerce.number().int().positive().optional() }), req.query);
  const to = q.to ?? today();
  const from = q.from ?? addPeriods(to.slice(0, 8) + '01', 'monthly', -11);
  res.json(await dashboard(req.db, { from, to, planId: q.planId }));
});

/* ---------- CSV exports (same filters as the lists) ---------- */
const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Neutralise spreadsheet formulas and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const rupees = (paise: unknown) => (Number(paise) / 100).toFixed(2);

function sendCsv(res: Response, name: string, header: string[], rows: unknown[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}-${today()}.csv"`);
  res.send('﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'));
}

const MAX_EXPORT = 50_000;

router.get('/export/:what', async (req, res) => {
  const what = String(req.params.what);
  if (what === 'invoices') {
    const { w, args, t } = invoiceFilters(req.query);
    const rows = await req.db.query<Record<string, unknown>>(`${INVOICE_LIST_SQL} ${w} ORDER BY i.invoice_date DESC, i.id DESC LIMIT ${MAX_EXPORT}`, [t, ...args]);
    sendCsv(res, 'invoices', ['Number', 'Kind', 'Status', 'Overdue', 'Customer', 'Subscription', 'Invoice date', 'Due date', 'Period start', 'Period end', 'Total (INR)', 'Paid (INR)', 'Balance (INR)'],
      rows.map((r) => [r.number, r.kind, r.status, r.overdue ? 'yes' : 'no', r.customer_name, r.subscription_number, r.invoice_date, r.due_date, r.period_start, r.period_end,
        rupees(r.total), rupees(r.amount_paid), rupees(r.balance)]));
    return;
  }
  if (what === 'subscriptions') {
    const { w, args } = subscriptionFilters(req.query);
    const rows = await req.db.query<Record<string, unknown>>(`${SUB_LIST_SQL} ${w} ORDER BY s.id DESC LIMIT ${MAX_EXPORT}`, args);
    sendCsv(res, 'subscriptions', ['Number', 'Status', 'Customer', 'Company', 'Plan', 'Period', 'Recurring (INR)', 'Start', 'End', 'Next invoice', 'Overdue invoices', 'Source'],
      rows.map((r) => [r.number, r.status, r.customer_name, r.customer_company, r.plan_name, r.period, rupees(r.recurring_amount), r.start_date, r.expiry_date, r.next_invoice_date, r.at_risk ? 'yes' : 'no', r.source]));
    return;
  }
  if (what === 'payments') {
    const { w, args } = paymentFilters(req.query);
    const rows = await req.db.query<Record<string, unknown>>(`SELECT ${PAYMENT_COLS} ${PAYMENT_FROM} ${w} ORDER BY pay.date DESC, pay.id DESC LIMIT ${MAX_EXPORT}`, args);
    sendCsv(res, 'payments', ['Date', 'Kind', 'Invoice', 'Customer', 'Method', 'Provider', 'Reference', 'Amount (INR)', 'Note'],
      rows.map((r) => [r.date, r.kind, r.invoice_number, r.customer_name, r.method, r.provider, r.provider_ref, rupees(r.kind === 'refund' ? -Number(r.amount) : r.amount), r.note]));
    return;
  }
  throw notFound('Export');
});

export default router;
