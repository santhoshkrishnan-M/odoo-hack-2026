import { Router } from 'express';
import { z } from 'zod';
import { validate, pageOf, PAGE_SIZE, isoDate, HttpError, idParam } from '../http';
import { requireRole, actor, appUrl } from '../middleware/auth';
import { camel, camelAll } from '../db/rows';
import { today } from '../domain/periods';
import { runBilling } from '../services/billing';
import { cancelInvoice, confirmInvoice, invoiceDetail, issueCreditNote, remindInvoice, sendInvoice } from '../services/invoices';
import { runDaily, lastRuns } from '../services/jobs';
import { activityFor } from '../services/activity';
import type { DB } from '../db/connection';
import { getSettings } from '../services/settings';

export const billingRouter = Router();
billingRouter.use(requireRole('admin', 'staff'));
billingRouter.post('/run', async (req, res) => {
  const b = validate(z.object({ asOf: isoDate.optional() }), req.body ?? {});
  res.json(await runBilling(req.db, b.asOf ?? today(), actor(req)));
});
/** Runs the whole daily automation now (billing, confirm, send, reminders, dunning, renewals). */
billingRouter.post('/automation', async (req, res) => {
  res.json(await runDaily(req.db, { appUrl: appUrl(req), trigger: 'manual', actor: actor(req) }));
});
billingRouter.get('/runs', async (req, res) => res.json({ rows: await lastRuns(req.db, 20) }));
billingRouter.get('/due', async (req, res) => {
  const row = await req.db.prepare(`SELECT count(*) AS n FROM subscriptions WHERE status = 'active' AND next_invoice_date <= ? AND (expiry_date IS NULL OR next_invoice_date < expiry_date)`).get(today());
  res.json(row);
});

const router = Router();
router.use(requireRole('admin', 'staff'));

export function invoiceFilters(query: Record<string, unknown>, customerId?: number, visibleToCustomer = false) {
  const where: string[] = [];
  const args: unknown[] = [];
  const t = today();
  if (customerId !== undefined) { where.push('i.customer_id = ?'); args.push(customerId); }
  if (visibleToCustomer) where.push("i.status IN ('confirmed','paid')");
  else if (query.customerId) { where.push('i.customer_id = ?'); args.push(Number(query.customerId) || 0); }
  if (['draft', 'confirmed', 'paid', 'cancelled'].includes(String(query.status))) { where.push('i.status = ?'); args.push(query.status); }
  if (['recurring', 'upsell', 'credit_note'].includes(String(query.kind))) { where.push('i.kind = ?'); args.push(query.kind); }
  if (query.overdue === '1') { where.push("i.status = 'confirmed' AND i.kind <> 'credit_note' AND i.due_date < ?"); args.push(t); }
  if (query.outstanding === '1') where.push("i.status = 'confirmed' AND i.kind <> 'credit_note'");
  if (query.subscriptionId) { where.push('i.subscription_id = ?'); args.push(Number(query.subscriptionId) || 0); }
  if (query.from) { where.push('i.invoice_date >= ?'); args.push(String(query.from)); }
  if (query.to) { where.push('i.invoice_date <= ?'); args.push(String(query.to)); }
  if (query.q) { where.push('(i.number ILIKE ? OR c.name ILIKE ? OR c.company ILIKE ?)'); args.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`); }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', args, t };
}

export const INVOICE_LIST_SQL = `SELECT i.id, i.number, i.kind, i.status, i.invoice_date, i.due_date, i.period_start, i.period_end, i.total, i.amount_paid,
      i.total - i.amount_paid AS balance, i.sent_at, i.reminder_count, c.id AS customer_id, c.name AS customer_name, s.number AS subscription_number,
      (i.status = 'confirmed' AND i.kind <> 'credit_note' AND i.due_date < ?) AS overdue
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN subscriptions s ON s.id = i.subscription_id`;

/** Shared invoice list query, also used by the portal with a customer filter. */
export async function listInvoices(db: DB, query: Record<string, unknown>, customerId?: number, visibleToCustomer = false) {
  const { page, limit, offset } = pageOf(query as never);
  const { w, args, t } = invoiceFilters(query, customerId, visibleToCustomer);
  const agg = (await db.prepare(`SELECT count(*) AS n, coalesce(sum(i.total), 0) AS total, coalesce(sum(i.total - i.amount_paid) FILTER (WHERE i.kind <> 'credit_note'), 0) AS balance
    FROM invoices i JOIN customers c ON c.id = i.customer_id ${w}`).get<{ n: number; total: number; balance: number }>(...args))!;
  const rows = camelAll(await db.query(`${INVOICE_LIST_SQL} ${w} ORDER BY i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`, [t, ...args, limit, offset]));
  return { rows, total: agg.n, sumTotal: agg.total, sumBalance: agg.balance, page, pageSize: PAGE_SIZE };
}

export async function invoiceJson(db: DB, id: number, withActivity = true) {
  const { inv, lines, payments, credits } = await invoiceDetail(db, id);
  const c = camel<Record<string, unknown>>(inv);
  const activity = withActivity ? await activityFor(db, 'invoice', id) : [];
  return { ...c, balance: Number(c.total) - Number(c.amountPaid), overdue: c.status === 'confirmed' && c.kind !== 'credit_note' && String(c.dueDate) < today(), lines, payments, credits, activity };
}

router.get('/', async (req, res) => res.json(await listInvoices(req.db, req.query)));
router.get('/:id', async (req, res) => res.json({ ...(await invoiceJson(req.db, idParam(req))), company: (await getSettings(req.db)).company }));
router.post('/:id/confirm', async (req, res) => res.json({ status: await confirmInvoice(req.db, idParam(req), actor(req)) }));
router.post('/:id/cancel', async (req, res) => res.json({ status: await cancelInvoice(req.db, idParam(req), actor(req)) }));
router.post('/:id/send', async (req, res) => {
  await sendInvoice(req.db, idParam(req), appUrl(req), actor(req));
  res.json({ ok: true });
});
router.post('/:id/remind', async (req, res) => {
  await remindInvoice(req.db, idParam(req), appUrl(req), actor(req));
  res.json({ ok: true });
});
router.post('/:id/credit', async (req, res) => {
  const b = validate(z.object({
    amount: z.number().int().positive('Enter an amount above zero.').nullable().optional(),
    reason: z.string().trim().min(3, 'Say why the credit is given.').max(300),
    refundMethod: z.enum(['bank_transfer', 'card', 'upi', 'cash', 'cheque']).optional(),
  }), req.body);
  res.status(201).json(await issueCreditNote(req.db, idParam(req), b, actor(req)));
});

router.post('/bulk', async (req, res) => {
  const b = validate(z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000), action: z.enum(['confirm', 'send', 'remind']) }), req.body);
  let done = 0;
  const failed: { id: number; error: string }[] = [];
  for (const id of b.ids) {
    try {
      if (b.action === 'confirm') await confirmInvoice(req.db, id, actor(req));
      else if (b.action === 'send') await sendInvoice(req.db, id, appUrl(req), actor(req));
      else await remindInvoice(req.db, id, appUrl(req), actor(req));
      done += 1;
    } catch (e) {
      failed.push({ id, error: e instanceof HttpError ? e.message : 'Failed.' });
    }
  }
  res.json({ done, failed });
});

export default router;
