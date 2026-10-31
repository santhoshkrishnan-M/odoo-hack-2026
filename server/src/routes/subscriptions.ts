import { Router } from 'express';
import { z } from 'zod';
import { validate, pageOf, PAGE_SIZE, isoDate, idParam, HttpError, notFound } from '../http';
import { requireRole, me, actor, appUrl } from '../middleware/auth';
import { camel, camelAll } from '../db/rows';
import { SUB_ACTIONS, SUB_STATUSES, type SubAction } from '../domain/lifecycle';
import { applySubscriptionAction, changeSubscription, createSubscription, renewSubscription, subscriptionDetail, updateSubscription } from '../services/subscriptions';
import { sendInvoice } from '../services/invoices';
import { getSettings } from '../services/settings';
import type { DB } from '../db/connection';

const router = Router();
router.use(requireRole('admin', 'staff'));

export const lineSchema = z.object({
  productId: z.number().int().positive('Choose a product.'),
  variantId: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
  quantity: z.number().int().min(1, 'At least 1.').max(100000),
  unitPrice: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  taxId: z.number().int().positive().nullable().optional(),
});

export const subscriptionSchema = z.object({
  customerId: z.number().int().positive('Choose a customer.'),
  planId: z.number().int().positive('Choose a plan.'),
  startDate: isoDate,
  expiryDate: isoDate.nullable().optional().transform((v) => v ?? null),
  paymentTermsDays: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]),
  notes: z.string().max(2000).default(''),
  lines: z.array(lineSchema).min(1, 'Add at least one product line.').max(50),
}).superRefine((s, ctx) => {
  if (s.expiryDate && s.expiryDate <= s.startDate) ctx.addIssue({ code: 'custom', path: ['expiryDate'], message: 'Must be after the start date.' });
});

export async function detailJson(db: DB, id: number) {
  const { s, lines, invoices, billing, mrr, activity } = await subscriptionDetail(db, id);
  return { ...camel(s as Record<string, unknown>), lines, invoices, billing, mrr, activity };
}

export function subscriptionFilters(q: Record<string, unknown>) {
  const where: string[] = [];
  const args: unknown[] = [];
  const status = String(q.status ?? '');
  if (SUB_STATUSES.includes(status as never)) { where.push('s.status = ?'); args.push(status); }
  if (q.planId) { where.push('s.plan_id = ?'); args.push(Number(q.planId) || 0); }
  if (q.customerId) { where.push('s.customer_id = ?'); args.push(Number(q.customerId) || 0); }
  if (q.q) { where.push('(s.number ILIKE ? OR c.name ILIKE ? OR c.company ILIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (q.atRisk === '1') where.push(`EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id = s.id AND i.status = 'confirmed' AND i.kind <> 'credit_note' AND i.due_date < CURRENT_DATE)`);
  if (q.endingSoon === '1') where.push(`s.status IN ('active','paused') AND s.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30`);
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

export const SUB_LIST_SQL = `SELECT s.id, s.number, s.status, s.start_date, s.expiry_date, s.next_invoice_date, s.valid_until, s.source,
      c.id AS customer_id, c.name AS customer_name, c.company AS customer_company, p.name AS plan_name, p.period,
      p.price + coalesce((SELECT sum(l.quantity * l.unit_price) FROM subscription_lines l WHERE l.subscription_id = s.id), 0) AS recurring_amount,
      EXISTS (SELECT 1 FROM invoices i WHERE i.subscription_id = s.id AND i.status = 'confirmed' AND i.kind <> 'credit_note' AND i.due_date < CURRENT_DATE) AS at_risk
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id`;

router.get('/', async (req, res) => {
  const { page, limit, offset } = pageOf(req.query);
  const { w, args } = subscriptionFilters(req.query);
  const total = (await req.db.prepare(`SELECT count(*) AS n FROM subscriptions s JOIN customers c ON c.id = s.customer_id ${w}`).get<{ n: number }>(...args))!.n;
  const rows = camelAll(await req.db.query(`${SUB_LIST_SQL} ${w} ORDER BY s.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]));
  res.json({ rows, total, page, pageSize: PAGE_SIZE });
});

router.get('/:id', async (req, res) => res.json(await detailJson(req.db, idParam(req))));

router.post('/', async (req, res) => {
  const b = validate(subscriptionSchema, req.body);
  res.status(201).json(await createSubscription(req.db, b, me(req).id, 'draft', actor(req)));
});

router.put('/:id', async (req, res) => {
  const b = validate(subscriptionSchema, req.body);
  await updateSubscription(req.db, idParam(req), b, actor(req));
  res.json({ ok: true });
});

router.post('/:id/actions/:action', async (req, res) => {
  const action = String(req.params.action) as SubAction;
  if (!SUB_ACTIONS.includes(action)) throw notFound('Action');
  const b = validate(z.object({ reasonId: z.number().int().positive().nullable().optional(), note: z.string().max(500).optional() }), req.body ?? {});
  const status = await applySubscriptionAction(req.db, idParam(req), action, actor(req), { reasonId: b.reasonId ?? null, note: b.note });
  res.json({ status });
});

router.post('/:id/renew', async (req, res) => {
  const expiryDate = await renewSubscription(req.db, idParam(req), actor(req));
  res.json({ expiryDate });
});

/** Upsell / downsell a running subscription with proration. */
router.post('/:id/change', async (req, res) => {
  const b = validate(z.object({ lines: z.array(lineSchema).min(1, 'Keep at least one product line.').max(50), prorate: z.boolean().default(true) }), req.body);
  const r = await changeSubscription(req.db, idParam(req), b, actor(req));
  const { billing } = await getSettings(req.db);
  if (billing.autoSend && r.upsell) await sendInvoice(req.db, r.upsell.id, appUrl(req), actor(req)).catch(() => undefined);
  res.json(r);
});

export { HttpError };
export default router;
