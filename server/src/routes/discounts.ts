import { Router } from 'express';
import { z } from 'zod';
import { validate, notFound, isoDate, idParam } from '../http';
import { requireRole, actor } from '../middleware/auth';
import { camel, camelAll } from '../db/rows';
import type { DB } from '../db/connection';
import { logActivity } from '../services/activity';

const router = Router();
router.use(requireRole('admin', 'staff'));
const adminOnly = requireRole('admin');

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  type: z.enum(['fixed', 'percent']),
  value: z.number().int().positive('Must be more than zero.').max(2_000_000_000),
  minAmount: z.number().int().min(0).max(2_000_000_000).default(0),
  minQuantity: z.number().int().min(0).max(1_000_000).default(0),
  startDate: isoDate.nullable().optional().transform((v) => v ?? null),
  endDate: isoDate.nullable().optional().transform((v) => v ?? null),
  usageLimit: z.number().int().positive('Must be at least 1, or leave blank for no limit.').nullable().optional().transform((v) => v ?? null),
  scope: z.enum(['products', 'subscriptions']),
  productIds: z.array(z.number().int().positive()).max(500).default([]),
  subscriptionIds: z.array(z.number().int().positive()).max(5000).default([]),
  active: z.boolean().optional(),
}).superRefine((d, ctx) => {
  if (d.type === 'percent' && d.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'A percentage cannot be over 100.' });
  if (d.startDate && d.endDate && d.endDate < d.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Must be on or after the start date.' });
  if (d.scope === 'products' && d.productIds.length === 0) ctx.addIssue({ code: 'custom', path: ['productIds'], message: 'Choose at least one product.' });
});

export async function loadDiscount(db: DB, id: number) {
  const d = await db.prepare('SELECT * FROM discounts WHERE id = ?').get(id);
  if (!d) throw notFound('Discount');
  const productIds = (await db.query<{ product_id: number }>('SELECT product_id FROM discount_products WHERE discount_id = ?', [id])).map((r) => r.product_id);
  const subscriptionIds = (await db.query<{ subscription_id: number }>('SELECT subscription_id FROM discount_subscriptions WHERE discount_id = ?', [id])).map((r) => r.subscription_id);
  return { ...camel(d as Record<string, unknown>), productIds, subscriptionIds };
}

async function saveLinks(db: DB, id: number, b: z.infer<typeof schema>) {
  await db.query('DELETE FROM discount_products WHERE discount_id = ?', [id]);
  await db.query('DELETE FROM discount_subscriptions WHERE discount_id = ?', [id]);
  if (b.scope === 'products') for (const p of new Set(b.productIds)) await db.query('INSERT INTO discount_products VALUES (?, ?)', [id, p]);
  if (b.scope === 'subscriptions') for (const s of new Set(b.subscriptionIds)) await db.query('INSERT INTO discount_subscriptions VALUES (?, ?)', [id, s]);
}

router.get('/', async (req, res) => {
  res.json({ rows: camelAll(await req.db.query('SELECT * FROM discounts ORDER BY active DESC, id DESC')) });
});
router.get('/:id', async (req, res) => res.json(await loadDiscount(req.db, idParam(req))));

router.post('/', adminOnly, async (req, res) => {
  const b = validate(schema, req.body);
  const id = await req.db.tx(async (t) => {
    const r = await t.prepare(`INSERT INTO discounts (name, type, value, min_amount, min_quantity, start_date, end_date, usage_limit, scope, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(b.name, b.type, b.value, b.minAmount, b.minQuantity, b.startDate, b.endDate, b.usageLimit, b.scope, b.active === false ? 0 : 1);
    await saveLinks(t, r.lastInsertRowid, b);
    await logActivity(t, { type: 'catalog.discount', entity: 'catalog', entityId: r.lastInsertRowid, actor: actor(req), message: `Discount ${b.name} created.` });
    return r.lastInsertRowid;
  });
  res.status(201).json({ id });
});

router.put('/:id', adminOnly, async (req, res) => {
  const b = validate(schema, req.body);
  const id = idParam(req);
  await req.db.tx(async (t) => {
    const r = await t.prepare(`UPDATE discounts SET name = ?, type = ?, value = ?, min_amount = ?, min_quantity = ?, start_date = ?, end_date = ?,
       usage_limit = ?, scope = ?, active = ? WHERE id = ?`).run(b.name, b.type, b.value, b.minAmount, b.minQuantity, b.startDate, b.endDate, b.usageLimit, b.scope, b.active === false ? 0 : 1, id);
    if (!r.changes) throw notFound('Discount');
    await saveLinks(t, id, b);
  });
  res.json({ ok: true });
});

export default router;
