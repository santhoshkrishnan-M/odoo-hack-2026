import { Router } from 'express';
import { z } from 'zod';
import { validate, notFound, isoDate, idParam } from '../http';
import { requireRole, me, actor } from '../middleware/auth';
import { camel, camelAll } from '../db/rows';
import { quoteFromTemplate } from '../services/subscriptions';
import type { DB } from '../db/connection';

const router = Router();
router.use(requireRole('admin', 'staff'));

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120),
  planId: z.number().int().positive('Choose a plan.'),
  validityDays: z.number().int().min(1, 'At least 1 day.').max(3650),
  paymentTermsDays: z.union([z.literal(0), z.literal(15), z.literal(30), z.literal(45)]).default(15),
  termMonths: z.number().int().min(1).max(120).nullable().optional().transform((v) => v ?? null),
  notes: z.string().max(2000).default(''),
  published: z.boolean().default(false),
  description: z.string().max(2000).default(''),
  lines: z.array(z.object({
    productId: z.number().int().positive('Choose a product.'),
    variantId: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
    quantity: z.number().int().min(1, 'At least 1.').max(100000),
  })).min(1, 'Add at least one product line.').max(50),
});

export async function loadTemplate(db: DB, id: number) {
  const t = await db.prepare('SELECT t.*, p.name AS plan_name FROM quotation_templates t JOIN plans p ON p.id = t.plan_id WHERE t.id = ?').get(id);
  if (!t) throw notFound('Template');
  const lines = camelAll(await db.query(`SELECT l.id, l.product_id, l.variant_id, l.quantity, pr.name AS product_name, v.value AS variant_value
     FROM template_lines l JOIN products pr ON pr.id = l.product_id LEFT JOIN product_variants v ON v.id = l.variant_id WHERE l.template_id = ? ORDER BY l.id`, [id]));
  return { ...camel(t as Record<string, unknown>), lines };
}

async function save(db: DB, id: number | null, b: z.infer<typeof schema>) {
  return db.tx(async (t) => {
    if (id) {
      const r = await t.prepare('UPDATE quotation_templates SET name = ?, plan_id = ?, validity_days = ?, payment_terms_days = ?, term_months = ?, notes = ?, published = ?, description = ? WHERE id = ?')
        .run(b.name, b.planId, b.validityDays, b.paymentTermsDays, b.termMonths, b.notes, +b.published, b.description, id);
      if (!r.changes) throw notFound('Template');
      await t.query('DELETE FROM template_lines WHERE template_id = ?', [id]);
    } else {
      id = (await t.prepare('INSERT INTO quotation_templates (name, plan_id, validity_days, payment_terms_days, term_months, notes, published, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(b.name, b.planId, b.validityDays, b.paymentTermsDays, b.termMonths, b.notes, +b.published, b.description)).lastInsertRowid;
    }
    for (const l of b.lines) await t.query('INSERT INTO template_lines (template_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)', [id, l.productId, l.variantId, l.quantity]);
    return id;
  });
}

router.get('/', async (req, res) => {
  const rows = camelAll(await req.db.query(`SELECT t.*, p.name AS plan_name, p.period, (SELECT count(*) FROM template_lines l WHERE l.template_id = t.id) AS line_count
     FROM quotation_templates t JOIN plans p ON p.id = t.plan_id ORDER BY t.name`));
  res.json({ rows });
});
router.get('/:id', async (req, res) => res.json(await loadTemplate(req.db, idParam(req))));
router.post('/', async (req, res) => res.status(201).json({ id: await save(req.db, null, validate(schema, req.body)) }));
router.put('/:id', async (req, res) => {
  await save(req.db, idParam(req), validate(schema, req.body));
  res.json({ ok: true });
});
router.post('/:id/quote', async (req, res) => {
  const b = validate(z.object({ customerId: z.number().int().positive('Choose a customer.'), startDate: isoDate }), req.body);
  res.status(201).json(await quoteFromTemplate(req.db, idParam(req), b.customerId, b.startDate, me(req).id, actor(req)));
});

export default router;
