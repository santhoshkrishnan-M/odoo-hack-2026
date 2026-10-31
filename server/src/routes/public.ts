import { Router } from 'express';
import type { DB } from '../db/connection';
import { getSettings } from '../services/settings';
import { monthlyFactor, type Period } from '../domain/periods';

/** Published offers (quotation templates marked "published") shown on the public plans page and in the portal. */
export async function publicOffers(db: DB) {
  const rows = await db.query<{ id: number; name: string; description: string; plan_name: string; period: Period; plan_price: number; term_months: number | null;
    tax_rate: number | null; min_quantity: number }>(`SELECT t.id, t.name, t.description, p.name AS plan_name, p.period, p.price AS plan_price, t.term_months, tx.rate AS tax_rate, p.min_quantity
    FROM quotation_templates t JOIN plans p ON p.id = t.plan_id LEFT JOIN taxes tx ON tx.id = p.tax_id
    WHERE t.published = 1 AND p.active = 1 AND (p.end_date IS NULL OR p.end_date >= CURRENT_DATE) AND (p.start_date IS NULL OR p.start_date <= CURRENT_DATE)
    ORDER BY p.price, t.id`);
  const lines = rows.length ? await db.query<{ template_id: number; name: string; value: string | null; quantity: number; unit: number }>(`SELECT l.template_id, pr.name, v.value, l.quantity,
      pr.sales_price + coalesce(v.extra_price, 0) AS unit FROM template_lines l JOIN products pr ON pr.id = l.product_id LEFT JOIN product_variants v ON v.id = l.variant_id
      WHERE l.template_id = ANY(?::int[]) ORDER BY l.id`, [rows.map((r) => r.id)]) : [];
  return rows.map((r) => {
    const items = lines.filter((l) => l.template_id === r.id).map((l) => ({ name: l.value ? `${l.name} (${l.value})` : l.name, quantity: l.quantity, unitPrice: l.unit }));
    const perPeriod = r.plan_price + items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
    return { id: r.id, name: r.name, description: r.description, planName: r.plan_name, period: r.period, termMonths: r.term_months, taxRate: r.tax_rate ?? 0,
      minQuantity: r.min_quantity, items, planPrice: r.plan_price, perPeriod, perMonth: Math.round(perPeriod * monthlyFactor(r.period)) };
  });
}

const router = Router();
router.get('/offers', async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ rows: await publicOffers(req.db) });
});
router.get('/company', async (req, res) => {
  const { company } = await getSettings(req.db);
  res.json({ name: company.name });
});
export default router;
