import type { DB } from '../db/connection';
import { priceInvoice, type DiscountRule, type PriceLine } from '../domain/pricing';
import { addDays, addPeriods, nextPeriodStart, type Period } from '../domain/periods';
import { nextNumber } from './numbering';
import { logActivity, recordMrr, subscriptionMrr, type Actor } from './activity';

export interface DueSub { id: number; number?: string; customer_id: number; plan_id: number; start_date: string; expiry_date: string | null; next_invoice_date: string;
  payment_terms_days: number; plan_name: string; plan_price: number; period: Period; auto_close: number; plan_tax_rate: number | null }

export async function loadDiscountRules(db: DB): Promise<DiscountRule[]> {
  const rows = await db.query<{
    id: number; type: 'fixed' | 'percent'; value: number; min_amount: number; min_quantity: number; start_date: string | null; end_date: string | null;
    usage_limit: number | null; used_count: number; scope: 'products' | 'subscriptions' }>('SELECT * FROM discounts WHERE active = 1');
  if (rows.length === 0) return [];
  const prods = await db.query<{ discount_id: number; product_id: number }>('SELECT discount_id, product_id FROM discount_products');
  const subs = await db.query<{ discount_id: number; subscription_id: number }>('SELECT discount_id, subscription_id FROM discount_subscriptions');
  return rows.map((r) => ({
    id: r.id, type: r.type, value: r.value, minAmount: r.min_amount, minQuantity: r.min_quantity, startDate: r.start_date, endDate: r.end_date,
    usageLimit: r.usage_limit, usedCount: r.used_count, scope: r.scope,
    productIds: prods.filter((p) => p.discount_id === r.id).map((p) => p.product_id),
    subscriptionIds: subs.filter((s) => s.discount_id === r.id).map((s) => s.subscription_id),
  }));
}

export async function insertInvoice(db: DB, inv: {
  kind: 'recurring' | 'upsell' | 'credit_note'; subscriptionId: number; customerId: number; periodStart: string; periodEnd: string; invoiceDate: string; dueDate: string;
  lines: PriceLine[]; rules?: DiscountRule[]; originInvoiceId?: number | null; note?: string; status?: 'draft' | 'confirmed';
}): Promise<{ id: number; number: string; total: number; appliedRuleIds: number[] }> {
  const priced = priceInvoice(inv.lines, inv.rules ?? [], { date: inv.periodStart, subscriptionId: inv.subscriptionId });
  const number = await nextNumber(db, inv.kind === 'credit_note' ? 'CN' : 'INV', Number(inv.invoiceDate.slice(0, 4)));
  const status = inv.status ?? 'draft';
  const r = await db.prepare(`INSERT INTO invoices (number, kind, origin_invoice_id, subscription_id, customer_id, status, period_start, period_end, invoice_date, due_date,
      subtotal, discount_total, tax_total, total, note, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 'confirmed' ? 'now()' : 'NULL'})`)
    .run(number, inv.kind, inv.originInvoiceId ?? null, inv.subscriptionId, inv.customerId, status, inv.periodStart, inv.periodEnd, inv.invoiceDate, inv.dueDate,
      priced.subtotal, priced.discountTotal, priced.taxTotal, priced.total, inv.note ?? '');
  const invoiceId = r.lastInsertRowid;
  if (priced.lines.length) {
    // One multi-row insert per invoice keeps billing runs fast over a network connection.
    const values: unknown[] = [];
    const tuples = priced.lines.map((l) => {
      values.push(invoiceId, l.productId, l.description, l.quantity, l.unitPrice, l.subtotal, l.discount, l.taxRate, l.tax, l.total);
      return '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    });
    await db.query(`INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price, subtotal, discount, tax_rate, tax, total) VALUES ${tuples.join(', ')}`, values);
  }
  for (const ruleId of priced.appliedRuleIds) {
    await db.query('INSERT INTO discount_usages (discount_id, invoice_id) VALUES (?, ?)', [ruleId, invoiceId]);
    await db.query('UPDATE discounts SET used_count = used_count + 1 WHERE id = ?', [ruleId]);
  }
  return { id: invoiceId, number, total: priced.total, appliedRuleIds: priced.appliedRuleIds };
}

export const productLines = (db: DB, subscriptionId: number) => db.query<PriceLine>(`SELECT l.product_id AS "productId", l.description, l.quantity, l.unit_price AS "unitPrice", coalesce(t.rate, 0) AS "taxRate"
        FROM subscription_lines l LEFT JOIN taxes t ON t.id = l.tax_id WHERE l.subscription_id = ? ORDER BY l.id`, [subscriptionId]);

export async function recurringLines(db: DB, sub: Pick<DueSub, 'id' | 'plan_name' | 'plan_price' | 'plan_tax_rate'>, periodStart: string, periodEnd: string, preloaded?: PriceLine[]): Promise<PriceLine[]> {
  const lines = preloaded ?? (await productLines(db, sub.id));
  return [
    { productId: null, description: `${sub.plan_name} (${periodStart} to ${addDays(periodEnd, -1)})`, quantity: 1, unitPrice: sub.plan_price, taxRate: sub.plan_tax_rate ?? 0 },
    ...lines,
  ];
}

/** Creates one draft invoice for the period starting at periodStart. Returns null if that period is already billed. */
export async function generateInvoice(db: DB, sub: DueSub, periodStart: string, periodEnd: string, rules?: DiscountRule[], preloaded?: PriceLine[]): Promise<number | null> {
  if (await db.prepare("SELECT 1 FROM invoices WHERE subscription_id = ? AND period_start = ? AND kind = 'recurring' AND status <> 'cancelled'").get(sub.id, periodStart)) return null;
  const lines = await recurringLines(db, sub, periodStart, periodEnd, preloaded);
  const r = await insertInvoice(db, {
    kind: 'recurring', subscriptionId: sub.id, customerId: sub.customer_id, periodStart, periodEnd, invoiceDate: periodStart,
    dueDate: addDays(periodStart, sub.payment_terms_days), lines, rules: rules ?? (await loadDiscountRules(db)),
  });
  // Keep the in-memory rule counters in step so one run never exceeds a usage limit.
  if (rules) for (const id of r.appliedRuleIds) { const rule = rules.find((x) => x.id === id); if (rule) rule.usedCount += 1; }
  return r.id;
}

export const DUE_SQL = `SELECT s.id, s.number, s.customer_id, s.plan_id, s.start_date, s.expiry_date, s.next_invoice_date, s.payment_terms_days,
    p.name AS plan_name, p.price AS plan_price, p.period, p.auto_close, t.rate AS plan_tax_rate
  FROM subscriptions s JOIN plans p ON p.id = s.plan_id LEFT JOIN taxes t ON t.id = p.tax_id`;

export interface BillingResult { created: number; closed: number; invoiceIds: number[]; closedIds: number[] }

/**
 * Bills every active subscription up to asOf, one invoice per period (catching up any missed ones), and closes
 * auto-close subscriptions that reached their end date — all in one transaction. A transaction-scoped advisory
 * lock serialises concurrent runs (a cron and a button press), and the unique (subscription, period) index is
 * the last line of defence against double billing.
 */
export async function runBilling(db: DB, asOf: string, actor?: Actor): Promise<{ created: number; closed: number }> {
  const r = await runBillingDetailed(db, asOf, actor);
  return { created: r.created, closed: r.closed };
}

export async function runBillingDetailed(db: DB, asOf: string, actor?: Actor): Promise<BillingResult> {
  return db.tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock(72022)');
    const invoiceIds: number[] = [];
    const closedIds: number[] = [];
    const rules = await loadDiscountRules(t);
    const due = await t.query<DueSub>(`${DUE_SQL} WHERE s.status = 'active' AND s.next_invoice_date IS NOT NULL AND s.next_invoice_date <= ? ORDER BY s.id`, [asOf]);
    for (const sub of due) {
      let ps = sub.next_invoice_date;
      const lines = await productLines(t, sub.id);
      while (ps <= asOf && (!sub.expiry_date || ps < sub.expiry_date)) {
        const next = nextPeriodStart(sub.start_date, sub.period, addDays(ps, 1));
        const id = await generateInvoice(t, sub, ps, next, rules, lines);
        if (id !== null) invoiceIds.push(id);
        ps = next;
      }
      await t.query('UPDATE subscriptions SET next_invoice_date = ?, updated_at = now() WHERE id = ?', [ps, sub.id]);
    }
    const ending = await t.query<{ id: number; number: string; customer_id: number; status: string; expiry_date: string }>(`SELECT s.id, s.number, s.customer_id, s.status, s.expiry_date
        FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.status IN ('active','paused') AND p.auto_close = 1 AND s.expiry_date IS NOT NULL AND s.expiry_date <= ?`, [asOf]);
    for (const s of ending) {
      const mrr = s.status === 'active' ? await subscriptionMrr(t, s.id) : 0;
      await t.query("UPDATE subscriptions SET status = 'closed', closed_at = now(), updated_at = now() WHERE id = ?", [s.id]);
      await recordMrr(t, s.id, 'churn', -mrr, s.expiry_date);
      await logActivity(t, { type: 'subscription.closed', entity: 'subscription', entityId: s.id, customerId: s.customer_id, actor,
        message: `${s.number} reached its end date and closed.`, data: { status: 'closed' } });
      closedIds.push(s.id);
    }
    if (invoiceIds.length || closedIds.length) {
      await logActivity(t, { type: 'billing.run', entity: 'billing', actor,
        message: `Billing run for ${asOf}: ${invoiceIds.length} invoice${invoiceIds.length === 1 ? '' : 's'} created, ${closedIds.length} subscription${closedIds.length === 1 ? '' : 's'} closed.`,
        data: { created: invoiceIds.length, closed: closedIds.length, asOf } });
    }
    return { created: invoiceIds.length, closed: closedIds.length, invoiceIds, closedIds };
  });
}

export { addPeriods };
