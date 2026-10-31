import type { DB } from '../db/connection';
import { conflict, notFound } from '../http';
import { nextStatus, type SubAction, type SubStatus } from '../domain/lifecycle';
import { addDays, addPeriods, daysBetween, nextPeriodStart, today, type Period } from '../domain/periods';
import { formatMoney } from '../domain/money';
import { nextNumber } from './numbering';
import { logActivity, recordMrr, subscriptionMrr, type Actor } from './activity';
import { DUE_SQL, generateInvoice, insertInvoice, type DueSub } from './billing';
import { creditNoteFor, getInvoiceRow } from './invoices';

export interface LineInput { productId: number; variantId: number | null; quantity: number; unitPrice?: number | null; taxId?: number | null }
export interface SubscriptionInput {
  customerId: number; planId: number; startDate: string; expiryDate: string | null; paymentTermsDays: 0 | 15 | 30 | 45;
  notes?: string; lines: LineInput[]; templateId?: number | null; validUntil?: string | null; source?: 'staff' | 'portal';
}
interface PlanRow { id: number; name: string; price: number; period: Period; min_quantity: number; start_date: string | null; end_date: string | null;
  auto_close: number; closable: number; pausable: number; renewable: number; active: number; tax_id: number | null }
interface SubRow { id: number; number: string; status: SubStatus; plan_id: number; start_date: string; expiry_date: string | null; valid_until: string | null;
  next_invoice_date: string | null; customer_id: number; source: string; payment_terms_days: number }

export async function getPlan(db: DB, id: number): Promise<PlanRow> {
  const p = await db.prepare('SELECT * FROM plans WHERE id = ?').get<PlanRow>(id);
  if (!p) throw notFound('Plan');
  return p;
}

export async function getSubRow(db: DB, id: number, lock = false): Promise<SubRow> {
  const s = await db.prepare(`SELECT * FROM subscriptions WHERE id = ?${lock && db.inTransaction ? ' FOR UPDATE' : ''}`).get<SubRow>(id);
  if (!s) throw notFound('Subscription');
  return s;
}

async function resolveLines(db: DB, plan: PlanRow, lines: LineInput[]) {
  const out = [];
  for (const l of lines) {
    const p = await db.prepare('SELECT id, name, sales_price, tax_id, active FROM products WHERE id = ?')
      .get<{ id: number; name: string; sales_price: number; tax_id: number | null; active: number }>(l.productId);
    if (!p) throw conflict('One of the products no longer exists.');
    let extra = 0;
    let description = p.name;
    if (l.variantId) {
      const v = await db.prepare('SELECT attribute, value, extra_price FROM product_variants WHERE id = ? AND product_id = ?')
        .get<{ attribute: string; value: string; extra_price: number }>(l.variantId, p.id);
      if (!v) throw conflict(`That variant does not belong to ${p.name}.`);
      extra = v.extra_price;
      description = `${p.name} (${v.attribute}: ${v.value})`;
    }
    if (l.quantity < plan.min_quantity) throw conflict(`${plan.name} needs a quantity of at least ${plan.min_quantity} on each line.`);
    out.push({ productId: p.id, variantId: l.variantId ?? null, description, quantity: l.quantity,
      unitPrice: l.unitPrice ?? p.sales_price + extra, taxId: l.taxId === undefined ? p.tax_id : l.taxId });
  }
  return out;
}
type Resolved = Awaited<ReturnType<typeof resolveLines>>;

function checkPlanAvailable(plan: PlanRow, startDate: string) {
  if (!plan.active) throw conflict(`${plan.name} is no longer offered.`);
  if ((plan.start_date && startDate < plan.start_date) || (plan.end_date && startDate > plan.end_date)) {
    throw conflict(`${plan.name} is only available from ${plan.start_date ?? 'any date'} to ${plan.end_date ?? 'any date'}.`);
  }
}

async function writeLines(db: DB, subId: number, lines: Resolved) {
  await db.query('DELETE FROM subscription_lines WHERE subscription_id = ?', [subId]);
  if (!lines.length) return;
  const values: unknown[] = [];
  const tuples = lines.map((l) => { values.push(subId, l.productId, l.variantId, l.description, l.quantity, l.unitPrice, l.taxId ?? null); return '(?, ?, ?, ?, ?, ?, ?)'; });
  await db.query(`INSERT INTO subscription_lines (subscription_id, product_id, variant_id, description, quantity, unit_price, tax_id) VALUES ${tuples.join(', ')}`, values);
}

export async function createSubscription(db: DB, input: SubscriptionInput, userId: number | null, status: SubStatus = 'draft', actor?: Actor): Promise<{ id: number; number: string }> {
  return db.tx(async (t) => {
    const plan = await getPlan(t, input.planId);
    checkPlanAvailable(plan, input.startDate);
    const customer = await t.prepare('SELECT id, name FROM customers WHERE id = ?').get<{ id: number; name: string }>(input.customerId);
    if (!customer) throw conflict('That customer does not exist.');
    if (input.lines.length === 0) throw conflict('Add at least one product line.');
    const lines = await resolveLines(t, plan, input.lines);
    const number = await nextNumber(t, 'SUB', Number(today().slice(0, 4)));
    const r = await t.prepare(`INSERT INTO subscriptions (number, customer_id, plan_id, template_id, status, start_date, expiry_date, valid_until, payment_terms_days, notes, source, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(number, input.customerId, input.planId, input.templateId ?? null, status, input.startDate,
      input.expiryDate, input.validUntil ?? null, input.paymentTermsDays, input.notes ?? '', input.source ?? 'staff', userId);
    const id = r.lastInsertRowid;
    await writeLines(t, id, lines);
    await logActivity(t, { type: 'subscription.created', entity: 'subscription', entityId: id, customerId: input.customerId, actor,
      message: `${number} created as ${status} for ${customer.name} on ${plan.name}.`, data: { status } });
    return { id, number };
  });
}

export async function updateSubscription(db: DB, id: number, input: SubscriptionInput, actor?: Actor) {
  await db.tx(async (t) => {
    const s = await getSubRow(t, id, true);
    if (s.status !== 'draft' && s.status !== 'quotation') throw conflict('Only drafts and quotations can be edited. Use “Change subscription” for running ones.');
    const plan = await getPlan(t, input.planId);
    checkPlanAvailable(plan, input.startDate);
    const lines = await resolveLines(t, plan, input.lines);
    if (lines.length === 0) throw conflict('Add at least one product line.');
    await t.query(`UPDATE subscriptions SET customer_id = ?, plan_id = ?, start_date = ?, expiry_date = ?, payment_terms_days = ?, notes = ?, updated_at = now() WHERE id = ?`,
      [input.customerId, input.planId, input.startDate, input.expiryDate, input.paymentTermsDays, input.notes ?? '', id]);
    await writeLines(t, id, lines);
    await logActivity(t, { type: 'subscription.updated', entity: 'subscription', entityId: id, customerId: input.customerId, actor, message: `${s.number} edited.` });
  });
}

interface TemplateRow { id: number; name: string; plan_id: number; validity_days: number; payment_terms_days: 0 | 15 | 30 | 45; term_months: number | null; notes: string; published: number }

async function getTemplate(db: DB, templateId: number) {
  const t = await db.prepare('SELECT * FROM quotation_templates WHERE id = ?').get<TemplateRow>(templateId);
  if (!t) throw notFound('Template');
  const lines = await db.query<LineInput>('SELECT product_id AS "productId", variant_id AS "variantId", quantity FROM template_lines WHERE template_id = ? ORDER BY id', [t.id]);
  return { t, lines };
}

export async function quoteFromTemplate(db: DB, templateId: number, customerId: number, startDate: string, userId: number | null, actor?: Actor) {
  const { t, lines } = await getTemplate(db, templateId);
  return createSubscription(db, {
    customerId, planId: t.plan_id, startDate, paymentTermsDays: t.payment_terms_days, notes: t.notes, lines, templateId: t.id,
    expiryDate: t.term_months ? addPeriods(startDate, 'monthly', t.term_months) : null,
    validUntil: addDays(today(), t.validity_days),
  }, userId, 'quotation', actor);
}

/**
 * Self-service order from the portal: the customer picks a published offer, a confirmed subscription and its
 * first invoice are created, and the subscription becomes active when that invoice is paid.
 */
export async function orderFromPortal(db: DB, templateId: number, customerId: number, quantity: number | null, actor: Actor) {
  return db.tx(async (t) => {
    const { t: tpl, lines } = await getTemplate(t, templateId);
    if (!tpl.published) throw notFound('Offer');
    const start = today();
    const ls = quantity ? lines.map((l, i) => (i === 0 ? { ...l, quantity } : l)) : lines;
    const sub = await createSubscription(t, {
      customerId, planId: tpl.plan_id, startDate: start, paymentTermsDays: 0, notes: `Ordered online: ${tpl.name}`, lines: ls, templateId: tpl.id,
      expiryDate: tpl.term_months ? addPeriods(start, 'monthly', tpl.term_months) : null, source: 'portal',
    }, actor.id, 'confirmed', actor);
    const due = await t.prepare(`${DUE_SQL} WHERE s.id = ?`).get<DueSub>(sub.id);
    const periodEnd = nextPeriodStart(due!.start_date, due!.period, addDays(start, 1));
    const invoiceId = (await generateInvoice(t, { ...due!, next_invoice_date: start }, start, periodEnd))!;
    const inv = await getInvoiceRow(t, invoiceId);
    await t.query(`UPDATE invoices SET status = CASE WHEN total = 0 THEN 'paid' ELSE 'confirmed' END, confirmed_at = now() WHERE id = ?`, [invoiceId]);
    if (inv.total === 0) await activateSubscription(t, sub.id, actor, { firstInvoiceId: invoiceId });
    return { subscriptionId: sub.id, number: sub.number, invoiceId, total: inv.total };
  });
}

/** Moves a confirmed subscription to active. When its first period is already invoiced, billing continues from the next one. */
export async function activateSubscription(db: DB, id: number, actor?: Actor, opts: { firstInvoiceId?: number } = {}) {
  const s = await getSubRow(db, id, true);
  if (s.status !== 'confirmed') throw conflict(`A ${s.status} subscription cannot be moved with "activate".`);
  const plan = await getPlan(db, s.plan_id);
  const next = opts.firstInvoiceId ? nextPeriodStart(s.start_date, plan.period, addDays(s.start_date, 1)) : s.next_invoice_date ?? s.start_date;
  await db.query("UPDATE subscriptions SET status = 'active', next_invoice_date = ?, updated_at = now() WHERE id = ?", [next, id]);
  const mrr = await subscriptionMrr(db, id);
  await recordMrr(db, id, 'new', mrr, s.start_date);
  await logActivity(db, { type: 'subscription.activated', entity: 'subscription', entityId: id, customerId: s.customer_id, actor,
    message: `${s.number} is active; billing ${formatMoney(mrr)} a month from ${s.start_date}.`, data: { status: 'active' } });
  return 'active' as SubStatus;
}

export async function applySubscriptionAction(db: DB, id: number, action: SubAction, actor?: Actor, opts: { reasonId?: number | null; note?: string } = {}): Promise<SubStatus> {
  return db.tx(async (t) => {
    const s = await getSubRow(t, id, true);
    const plan = await getPlan(t, s.plan_id);
    const to = nextStatus(s.status, action);
    if (!to) throw conflict(`A ${s.status} subscription cannot be moved with "${action}".`);
    const now = today();
    if (action === 'send' && !s.valid_until) await t.query('UPDATE subscriptions SET valid_until = ? WHERE id = ?', [addDays(now, 30), id]);
    if (action === 'confirm' && s.valid_until && s.valid_until < now) throw conflict(`This quotation expired on ${s.valid_until}. Send a new quotation.`);
    if (action === 'pause' && !plan.pausable) throw conflict(`${plan.name} does not allow pausing.`);
    if (action === 'close' && ['confirmed', 'active', 'paused'].includes(s.status) && !plan.closable && (!s.expiry_date || now < s.expiry_date)) {
      throw conflict(`${plan.name} cannot be closed before its expiry date.`);
    }
    if (action === 'activate') return activateSubscription(t, id, actor);

    let next = s.next_invoice_date;
    if (action === 'resume' && next && next < now) next = nextPeriodStart(s.start_date, plan.period, now);
    await t.query(`UPDATE subscriptions SET status = ?, next_invoice_date = ?, updated_at = now(),
        closed_at = CASE WHEN ?::text = 'closed' THEN now() ELSE closed_at END,
        close_reason_id = CASE WHEN ?::text = 'closed' THEN ?::int ELSE close_reason_id END,
        close_note = CASE WHEN ?::text = 'closed' THEN ? ELSE close_note END WHERE id = ?`,
      [to, next, to, to, opts.reasonId ?? null, to, opts.note ?? '', id]);

    const mrr = await subscriptionMrr(t, id);
    if (action === 'pause') await recordMrr(t, id, 'contraction', -mrr, now);
    if (action === 'resume') await recordMrr(t, id, 'reactivation', mrr, now);
    if (action === 'close' && s.status === 'active') await recordMrr(t, id, 'churn', -mrr, now);
    if (action === 'close' && s.status === 'paused') await recordMrr(t, id, 'churn', 0, now);

    const reason = opts.reasonId ? (await t.prepare('SELECT name FROM close_reasons WHERE id = ?').get<{ name: string }>(opts.reasonId))?.name : null;
    const words: Record<SubAction, string> = {
      send: 'sent as a quotation', confirm: s.status === 'quotation' ? 'accepted' : 'confirmed', activate: 'activated', pause: 'paused', resume: 'resumed',
      close: ['draft', 'quotation'].includes(s.status) ? 'cancelled' : 'closed',
    };
    await logActivity(t, { type: `subscription.${action === 'close' ? 'closed' : action === 'confirm' ? 'confirmed' : action === 'send' ? 'sent' : action === 'pause' ? 'paused' : 'resumed'}`,
      entity: 'subscription', entityId: id, customerId: s.customer_id, actor,
      message: `${s.number} ${words[action]}${reason ? ` — ${reason}` : ''}${opts.note ? ` (“${opts.note}”)` : ''}.`, data: { status: to } });
    return to;
  });
}

/** Extend the expiry by the original term; reopens a subscription that closed by reaching its expiry. */
export async function renewSubscription(db: DB, id: number, actor?: Actor): Promise<string> {
  return db.tx(async (t) => {
    const s = await getSubRow(t, id, true);
    const plan = await getPlan(t, s.plan_id);
    if (!plan.renewable) throw conflict(`${plan.name} cannot be renewed.`);
    if (!s.expiry_date) throw conflict('This subscription has no end date, so there is nothing to renew.');
    if (!['active', 'paused', 'closed'].includes(s.status)) throw conflict('Only running or ended subscriptions can be renewed.');
    if (s.status === 'closed' && s.expiry_date > today()) throw conflict('This subscription was closed early and cannot be renewed.');
    let months = 0;
    for (let k = 1; k <= 120; k++) if (addPeriods(s.start_date, 'monthly', k) === s.expiry_date) { months = k; break; }
    const newExpiry = months ? addPeriods(s.expiry_date, 'monthly', months) : addDays(s.expiry_date, daysBetween(s.start_date, s.expiry_date));
    const reopen = s.status === 'closed';
    await t.query(`UPDATE subscriptions SET expiry_date = ?, status = CASE WHEN ? THEN 'active' ELSE status END, closed_at = CASE WHEN ? THEN NULL ELSE closed_at END,
      close_reason_id = CASE WHEN ? THEN NULL ELSE close_reason_id END, updated_at = now() WHERE id = ?`, [newExpiry, reopen, reopen, reopen, id]);
    if (reopen) await recordMrr(t, id, 'reactivation', await subscriptionMrr(t, id), today());
    await logActivity(t, { type: 'subscription.renewed', entity: 'subscription', entityId: id, customerId: s.customer_id, actor,
      message: `${s.number} renewed until ${newExpiry}${reopen ? ' and reopened' : ''}.`, data: { status: reopen ? 'active' : s.status, expiryDate: newExpiry } });
    return newExpiry;
  });
}

/**
 * Upsell or downsell a running subscription (Odoo's "upsell" order). New lines apply from the next invoice; the rest of the
 * current billed period is settled now: an extra prorated invoice for an increase, a prorated credit note for a decrease.
 */
export async function changeSubscription(db: DB, id: number, input: { lines: LineInput[]; prorate?: boolean }, actor?: Actor) {
  return db.tx(async (t) => {
    const s = await getSubRow(t, id, true);
    if (!['active', 'paused', 'confirmed'].includes(s.status)) throw conflict('Only confirmed, active or paused subscriptions can be changed this way.');
    if (input.lines.length === 0) throw conflict('Keep at least one product line.');
    const plan = await getPlan(t, s.plan_id);
    const lines = await resolveLines(t, plan, input.lines);
    const before = await t.query<{ amount: number; rate: number }>(`SELECT l.quantity * l.unit_price AS amount, coalesce(tx.rate, 0) AS rate
      FROM subscription_lines l LEFT JOIN taxes tx ON tx.id = l.tax_id WHERE l.subscription_id = ?`, [id]);
    const taxRates = new Map((await t.query<{ id: number; rate: number }>('SELECT id, rate FROM taxes')).map((x) => [x.id, Number(x.rate)]));
    const oldMrr = await subscriptionMrr(t, id);
    await writeLines(t, id, lines);
    await t.query('UPDATE subscriptions SET updated_at = now() WHERE id = ?', [id]);
    const newMrr = await subscriptionMrr(t, id);
    const deltaMrr = newMrr - oldMrr;

    // Net change per tax rate, per billing period.
    const byRate = new Map<number, number>();
    for (const b of before) byRate.set(Number(b.rate), (byRate.get(Number(b.rate)) ?? 0) - b.amount);
    for (const l of lines) { const rate = l.taxId ? taxRates.get(l.taxId) ?? 0 : 0; byRate.set(rate, (byRate.get(rate) ?? 0) + l.quantity * l.unitPrice); }

    let upsell: { id: number; number: string; total: number } | null = null;
    let credit: { id: number; number: string; total: number; applied: number; refunded: number } | null = null;
    const now = today();
    const current = s.status === 'active' && input.prorate !== false
      ? await t.prepare(`SELECT id, period_start, period_end FROM invoices WHERE subscription_id = ? AND kind = 'recurring' AND status IN ('confirmed','paid','draft')
          AND period_start <= ? AND period_end > ? ORDER BY period_start DESC LIMIT 1`).get<{ id: number; period_start: string; period_end: string }>(id, now, now)
      : undefined;
    if (current) {
      const total = daysBetween(current.period_start, current.period_end);
      const left = daysBetween(now, current.period_end);
      const share = total > 0 ? left / total : 0;
      const label = `${now} to ${addDays(current.period_end, -1)}, ${left} of ${total} days`;
      const ups = [...byRate.entries()].filter(([, v]) => v > 0).map(([rate, v]) => ({ productId: null, description: `Upgrade, prorated (${label})`, quantity: 1, unitPrice: Math.round(v * share), taxRate: rate }));
      const downs = [...byRate.entries()].filter(([, v]) => v < 0).map(([rate, v]) => ({ rate, net: Math.round(-v * share) }));
      if (ups.some((u) => u.unitPrice > 0)) {
        upsell = await insertInvoice(t, { kind: 'upsell', subscriptionId: id, customerId: s.customer_id, periodStart: now, periodEnd: current.period_end, invoiceDate: now,
          dueDate: addDays(now, s.payment_terms_days), lines: ups.filter((u) => u.unitPrice > 0), status: 'confirmed', note: `Mid-period upgrade of ${s.number}` });
      }
      const creditGross = downs.reduce((a, d) => a + d.net + Math.round((d.net * d.rate) / 100), 0);
      if (creditGross > 0) {
        const inv = await getInvoiceRow(t, current.id, true);
        if (inv.status === 'draft') {
          // Not issued yet: nothing to credit — the draft is re-priced instead when it is confirmed. Keep it simple and skip.
        } else {
          const already = (await t.prepare(`SELECT coalesce(sum(total), 0) AS v FROM invoices WHERE origin_invoice_id = ? AND kind = 'credit_note' AND status <> 'cancelled'`).get<{ v: number }>(inv.id))!.v;
          const amount = Math.min(creditGross, inv.total - already);
          if (amount > 0) credit = await creditNoteFor(t, inv, amount, `Downgrade, prorated (${label})`, 'bank_transfer', actor);
        }
      }
    }
    if (deltaMrr !== 0 && s.status !== 'confirmed') await recordMrr(t, id, deltaMrr > 0 ? 'expansion' : 'contraction', deltaMrr, now);
    await logActivity(t, { type: 'subscription.changed', entity: 'subscription', entityId: id, customerId: s.customer_id, actor,
      message: `${s.number} ${deltaMrr > 0 ? 'upgraded' : deltaMrr < 0 ? 'downgraded' : 'changed'}: ${formatMoney(oldMrr)} → ${formatMoney(newMrr)} a month` +
        `${upsell ? `; prorated invoice ${upsell.number} for ${formatMoney(upsell.total)}` : ''}${credit ? `; credit note ${credit.number} for ${formatMoney(credit.total)}` : ''}.`,
      data: { oldMrr, newMrr, upsellInvoiceId: upsell?.id ?? null, creditNoteId: credit?.id ?? null } });
    return { oldMrr, newMrr, upsell, credit };
  });
}

export async function subscriptionDetail(db: DB, id: number) {
  const s = await db.prepare(`SELECT s.*, c.name AS customer_name, c.email AS customer_email, p.name AS plan_name, p.period, p.price AS plan_price,
      p.pausable, p.closable, p.renewable, p.auto_close, p.min_quantity, t.name AS template_name, pt.name AS plan_tax_name, cr.name AS close_reason
    FROM subscriptions s JOIN customers c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id
    LEFT JOIN quotation_templates t ON t.id = s.template_id LEFT JOIN taxes pt ON pt.id = p.tax_id LEFT JOIN close_reasons cr ON cr.id = s.close_reason_id WHERE s.id = ?`).get(id);
  if (!s) throw notFound('Subscription');
  const lines = await db.query(`SELECT l.id, l.product_id AS "productId", l.variant_id AS "variantId", l.description, l.quantity, l.unit_price AS "unitPrice",
      l.tax_id AS "taxId", t.name AS "taxName", t.rate AS "taxRate", l.quantity * l.unit_price AS amount
    FROM subscription_lines l LEFT JOIN taxes t ON t.id = l.tax_id WHERE l.subscription_id = ? ORDER BY l.id`, [id]);
  const invoices = await db.query(`SELECT id, number, kind, status, invoice_date AS "invoiceDate", due_date AS "dueDate", period_start AS "periodStart",
      period_end AS "periodEnd", total, amount_paid AS "amountPaid" FROM invoices WHERE subscription_id = ? ORDER BY invoice_date DESC, id DESC`, [id]);
  const billing = (await db.prepare(`SELECT coalesce(sum(total) FILTER (WHERE kind <> 'credit_note'), 0) AS invoiced,
      coalesce(sum(total) FILTER (WHERE kind = 'credit_note'), 0) AS credited,
      coalesce(sum(amount_paid) FILTER (WHERE kind <> 'credit_note'), 0) AS paid,
      coalesce(sum(total - amount_paid) FILTER (WHERE status = 'confirmed' AND kind <> 'credit_note'), 0) AS owed,
      count(*) FILTER (WHERE status = 'confirmed' AND kind <> 'credit_note' AND due_date < CURRENT_DATE) AS overdue
    FROM invoices WHERE subscription_id = ? AND status IN ('confirmed','paid')`).get<{ invoiced: number; credited: number; paid: number; owed: number; overdue: number }>(id))!;
  const mrr = await subscriptionMrr(db, id);
  // The subscription's own history plus its invoices' (confirmations, payments, credits, reminders).
  const activity = await db.query(`(SELECT id, created_at AS "createdAt", type, actor_name AS "actorName", message FROM activity WHERE entity = 'subscription' AND entity_id = ? ORDER BY id DESC LIMIT 50)
    UNION ALL (SELECT id, created_at, type, actor_name, message FROM activity WHERE (data->>'subscriptionId')::int = ? ORDER BY id DESC LIMIT 50)
    ORDER BY id DESC LIMIT 60`, [id, id]);
  return { s, lines, invoices, billing, mrr, activity };
}
