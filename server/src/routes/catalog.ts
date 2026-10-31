import { Router } from 'express';
import { z } from 'zod';
import { validate, notFound, money, isoDate, idParam } from '../http';
import { requireRole, actor } from '../middleware/auth';
import { camel, camelAll } from '../db/rows';
import type { DB } from '../db/connection';
import { logActivity } from '../services/activity';

const router = Router();
router.use(['/taxes', '/products', '/plans'], requireRole('admin', 'staff'));
const adminOnly = requireRole('admin');
const nullableId = z.number().int().positive().nullable().optional().transform((v) => v ?? null);
const flag = (b: boolean | undefined) => (b === false ? 0 : 1);

/* ---------- taxes ---------- */
const taxSchema = z.object({ name: z.string().trim().min(1, 'Enter a name.').max(80), rate: z.number().min(0).max(100, 'Rate must be between 0 and 100.'), active: z.boolean().optional() });

router.get('/taxes', async (req, res) => {
  res.json({ rows: camelAll(await req.db.query('SELECT * FROM taxes ORDER BY active DESC, rate, id')) });
});
router.post('/taxes', adminOnly, async (req, res) => {
  const b = validate(taxSchema, req.body);
  const r = await req.db.prepare('INSERT INTO taxes (name, rate, active) VALUES (?, ?, ?)').run(b.name, b.rate, flag(b.active));
  await logActivity(req.db, { type: 'catalog.tax', entity: 'catalog', actor: actor(req), message: `Tax ${b.name} (${b.rate}%) added.` });
  res.status(201).json({ id: r.lastInsertRowid });
});
router.put('/taxes/:id', adminOnly, async (req, res) => {
  const b = validate(taxSchema, req.body);
  const r = await req.db.prepare('UPDATE taxes SET name = ?, rate = ?, active = ? WHERE id = ?').run(b.name, b.rate, flag(b.active), idParam(req));
  if (!r.changes) throw notFound('Tax');
  res.json({ ok: true });
});

/* ---------- products ---------- */
const variantSchema = z.object({ id: z.number().int().optional(), attribute: z.string().trim().min(1, 'Enter an attribute.').max(80), value: z.string().trim().min(1, 'Enter a value.').max(80), extraPrice: z.number().int().min(-2_000_000_000).max(2_000_000_000) });
const productSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(160),
  type: z.enum(['service', 'goods']),
  salesPrice: money,
  costPrice: money,
  notes: z.string().max(2000).default(''),
  taxId: nullableId,
  active: z.boolean().optional(),
  variants: z.array(variantSchema).max(100).default([]),
});

export async function getProduct(db: DB, id: number) {
  const p = await db.prepare('SELECT p.*, t.name AS tax_name, t.rate AS tax_rate FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.id = ?').get(id);
  if (!p) throw notFound('Product');
  const variants = camelAll(await db.query('SELECT * FROM product_variants WHERE product_id = ? ORDER BY attribute, value', [id]));
  return { ...camel(p as Record<string, unknown>), variants };
}

async function saveVariants(db: DB, productId: number, variants: z.infer<typeof variantSchema>[]) {
  const keep = variants.filter((v) => v.id).map((v) => v.id!);
  const existing = (await db.query<{ id: number }>('SELECT id FROM product_variants WHERE product_id = ?', [productId])).map((r) => r.id);
  for (const old of existing) if (!keep.includes(old)) {
    const used = await db.prepare('SELECT 1 FROM subscription_lines WHERE variant_id = ? UNION SELECT 1 FROM template_lines WHERE variant_id = ?').get(old, old);
    if (!used) await db.query('DELETE FROM product_variants WHERE id = ?', [old]);
  }
  for (const v of variants) {
    if (v.id && existing.includes(v.id)) await db.query('UPDATE product_variants SET attribute = ?, value = ?, extra_price = ? WHERE id = ?', [v.attribute, v.value, v.extraPrice, v.id]);
    else await db.query('INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES (?, ?, ?, ?)', [productId, v.attribute, v.value, v.extraPrice]);
  }
}

router.get('/products', async (req, res) => {
  const q = `%${String(req.query.q ?? '')}%`;
  const rows = camelAll(await req.db.query(`SELECT p.*, t.name AS tax_name, (SELECT count(*) FROM product_variants v WHERE v.product_id = p.id) AS variant_count
     FROM products p LEFT JOIN taxes t ON t.id = p.tax_id WHERE p.name ILIKE ? ORDER BY p.active DESC, p.name`, [q]));
  const variants = camelAll(await req.db.query('SELECT * FROM product_variants ORDER BY attribute, value')) as { productId: number }[];
  res.json({ rows: rows.map((p) => ({ ...p, variants: variants.filter((v) => v.productId === (p as { id: number }).id) })) });
});
router.get('/products/:id', async (req, res) => res.json(await getProduct(req.db, idParam(req))));
router.post('/products', adminOnly, async (req, res) => {
  const b = validate(productSchema, req.body);
  const id = await req.db.tx(async (t) => {
    const r = await t.prepare('INSERT INTO products (name, type, sales_price, cost_price, notes, tax_id, active) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(b.name, b.type, b.salesPrice, b.costPrice, b.notes, b.taxId, flag(b.active));
    await saveVariants(t, r.lastInsertRowid, b.variants);
    await logActivity(t, { type: 'catalog.product', entity: 'catalog', entityId: r.lastInsertRowid, actor: actor(req), message: `Product ${b.name} added.` });
    return r.lastInsertRowid;
  });
  res.status(201).json({ id });
});
router.put('/products/:id', adminOnly, async (req, res) => {
  const b = validate(productSchema, req.body);
  const id = idParam(req);
  await req.db.tx(async (t) => {
    const r = await t.prepare('UPDATE products SET name = ?, type = ?, sales_price = ?, cost_price = ?, notes = ?, tax_id = ?, active = ? WHERE id = ?')
      .run(b.name, b.type, b.salesPrice, b.costPrice, b.notes, b.taxId, flag(b.active), id);
    if (!r.changes) throw notFound('Product');
    await saveVariants(t, id, b.variants);
    await logActivity(t, { type: 'catalog.product', entity: 'catalog', entityId: id, actor: actor(req), message: `Product ${b.name} updated.` });
  });
  res.json({ ok: true });
});

/* ---------- plans ---------- */
const planSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  price: money,
  period: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  minQuantity: z.number().int().min(1, 'At least 1.').max(100000),
  startDate: isoDate.nullable().optional().transform((v) => v ?? null),
  endDate: isoDate.nullable().optional().transform((v) => v ?? null),
  autoClose: z.boolean(),
  closable: z.boolean(),
  pausable: z.boolean(),
  renewable: z.boolean(),
  taxId: nullableId,
  active: z.boolean().optional(),
}).superRefine((p, ctx) => {
  if (p.startDate && p.endDate && p.endDate < p.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Must be on or after the start date.' });
});

const planCols = (b: z.infer<typeof planSchema>) => [b.name, b.price, b.period, b.minQuantity, b.startDate, b.endDate, +b.autoClose, +b.closable, +b.pausable, +b.renewable, b.taxId, flag(b.active)];

router.get('/plans', async (req, res) => {
  const rows = camelAll(await req.db.query(`SELECT p.*, t.name AS tax_name, t.rate AS tax_rate,
      (SELECT count(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active') AS active_count
     FROM plans p LEFT JOIN taxes t ON t.id = p.tax_id ORDER BY p.active DESC, p.name`));
  res.json({ rows });
});
router.get('/plans/:id', async (req, res) => {
  const p = await req.db.prepare('SELECT * FROM plans WHERE id = ?').get(idParam(req));
  if (!p) throw notFound('Plan');
  res.json(camel(p as Record<string, unknown>));
});
router.post('/plans', adminOnly, async (req, res) => {
  const b = validate(planSchema, req.body);
  const r = await req.db.prepare(`INSERT INTO plans (name, price, period, min_quantity, start_date, end_date, auto_close, closable, pausable, renewable, tax_id, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...planCols(b));
  await logActivity(req.db, { type: 'catalog.plan', entity: 'catalog', entityId: r.lastInsertRowid, actor: actor(req), message: `Plan ${b.name} launched.` });
  res.status(201).json({ id: r.lastInsertRowid });
});
router.put('/plans/:id', adminOnly, async (req, res) => {
  const b = validate(planSchema, req.body);
  const r = await req.db.prepare(`UPDATE plans SET name = ?, price = ?, period = ?, min_quantity = ?, start_date = ?, end_date = ?, auto_close = ?,
     closable = ?, pausable = ?, renewable = ?, tax_id = ?, active = ? WHERE id = ?`).run(...planCols(b), idParam(req));
  if (!r.changes) throw notFound('Plan');
  res.json({ ok: true });
});

export default router;
