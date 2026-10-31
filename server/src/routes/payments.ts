import { Router } from 'express';
import { z } from 'zod';
import { validate, pageOf, PAGE_SIZE, isoDate } from '../http';
import { requireRole, me, actor } from '../middleware/auth';
import { camelAll } from '../db/rows';
import { METHODS, recordPayment, type PaymentInput } from '../services/payments';

const router = Router();
router.use(requireRole('admin', 'staff'));

export function paymentFilters(q: Record<string, unknown>) {
  const where: string[] = [];
  const args: unknown[] = [];
  if ([...METHODS, 'credit_note'].includes(String(q.method) as never)) { where.push('pay.method = ?'); args.push(q.method); }
  if (['payment', 'refund'].includes(String(q.kind))) { where.push('pay.kind = ?'); args.push(q.kind); }
  if (['manual', 'razorpay', 'sandbox', 'system'].includes(String(q.provider))) { where.push('pay.provider = ?'); args.push(q.provider); }
  if (q.provider === 'online') where.push("pay.provider IN ('razorpay','sandbox')");
  if (q.from) { where.push('pay.date >= ?'); args.push(String(q.from)); }
  if (q.to) { where.push('pay.date <= ?'); args.push(String(q.to)); }
  if (q.q) { where.push('(i.number ILIKE ? OR c.name ILIKE ? OR pay.note ILIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}
export const PAYMENT_FROM = 'FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN customers c ON c.id = i.customer_id';
export const PAYMENT_COLS = `pay.id, pay.kind, pay.method, pay.amount, pay.date, pay.note, pay.provider, pay.provider_ref, i.id AS invoice_id, i.number AS invoice_number,
      c.id AS customer_id, c.name AS customer_name`;

router.get('/', async (req, res) => {
  const { page, limit, offset } = pageOf(req.query);
  const { w, args } = paymentFilters(req.query);
  const agg = (await req.db.prepare(`SELECT count(*) AS n, coalesce(sum(CASE WHEN pay.kind = 'refund' THEN -pay.amount ELSE pay.amount END), 0) AS total ${PAYMENT_FROM} ${w}`)
    .get<{ n: number; total: number }>(...args))!;
  const rows = camelAll(await req.db.query(`SELECT ${PAYMENT_COLS} ${PAYMENT_FROM} ${w} ORDER BY pay.date DESC, pay.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]));
  res.json({ rows, total: agg.n, sumAmount: agg.total, page, pageSize: PAGE_SIZE });
});

router.post('/', async (req, res) => {
  const b = validate(z.object({
    invoiceId: z.number().int().positive(),
    method: z.enum(METHODS as [string, ...string[]]),
    amount: z.number().int('Use whole paise.').positive('Enter an amount above zero.').max(2_000_000_000),
    date: isoDate,
    note: z.string().max(500).default(''),
  }), req.body);
  const id = await recordPayment(req.db, b as PaymentInput, me(req).id, actor(req));
  res.status(201).json({ id });
});

export default router;
