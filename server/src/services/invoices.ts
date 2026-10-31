import type { DB } from '../db/connection';
import { conflict, notFound, badRequest } from '../http';
import { formatMoney } from '../domain/money';
import { today } from '../domain/periods';
import type { InvStatus } from '../domain/lifecycle';
import { sendMail } from './mail';
import { logActivity, type Actor } from './activity';
import { insertInvoice } from './billing';
import { getSettings } from './settings';

export interface InvRow { id: number; number: string; kind: string; status: InvStatus; total: number; amount_paid: number; due_date: string; customer_id: number;
  subscription_id: number; invoice_date: string; origin_invoice_id: number | null }

export async function getInvoiceRow(db: DB, id: number, lock = false): Promise<InvRow> {
  const r = await db.prepare(`SELECT id, number, kind, status, total, amount_paid, due_date, customer_id, subscription_id, invoice_date, origin_invoice_id
    FROM invoices WHERE id = ?${lock && db.inTransaction ? ' FOR UPDATE' : ''}`).get<InvRow>(id);
  if (!r) throw notFound('Invoice');
  return r;
}

const docWord = (inv: { kind: string }) => (inv.kind === 'credit_note' ? 'credit note' : 'invoice');

export async function confirmInvoice(db: DB, id: number, actor?: Actor): Promise<InvStatus> {
  return db.tx(async (t) => {
    const inv = await getInvoiceRow(t, id, true);
    if (inv.status !== 'draft') throw conflict(`${inv.number} is ${inv.status}; only drafts can be confirmed.`);
    const status: InvStatus = inv.total === 0 ? 'paid' : 'confirmed';
    await t.query('UPDATE invoices SET status = ?, confirmed_at = now() WHERE id = ?', [status, id]);
    await logActivity(t, { type: 'invoice.confirmed', entity: 'invoice', entityId: id, customerId: inv.customer_id, actor,
      message: `${inv.number} confirmed${status === 'paid' ? ' (nothing to pay)' : ` for ${formatMoney(inv.total)}`}.`, data: { status, subscriptionId: inv.subscription_id } });
    return status;
  });
}

export async function cancelInvoice(db: DB, id: number, actor?: Actor): Promise<InvStatus> {
  return db.tx(async (t) => {
    const inv = await getInvoiceRow(t, id, true);
    if (inv.status === 'paid' || inv.status === 'cancelled') throw conflict(`${inv.number} is ${inv.status} and cannot be cancelled.`);
    if (inv.amount_paid > 0) throw conflict(`${inv.number} already has payments recorded and cannot be cancelled. Issue a credit note instead.`);
    await t.query("UPDATE invoices SET status = 'cancelled' WHERE id = ?", [id]);
    const uses = await t.query<{ discount_id: number }>('SELECT discount_id FROM discount_usages WHERE invoice_id = ?', [id]);
    for (const u of uses) await t.query('UPDATE discounts SET used_count = greatest(used_count - 1, 0) WHERE id = ?', [u.discount_id]);
    await t.query('DELETE FROM discount_usages WHERE invoice_id = ?', [id]);
    await t.query('UPDATE checkouts SET status = \'expired\' WHERE invoice_id = ? AND status = \'pending\'', [id]);
    await logActivity(t, { type: 'invoice.cancelled', entity: 'invoice', entityId: id, customerId: inv.customer_id, actor, message: `${inv.number} cancelled.`,
      data: { status: 'cancelled', subscriptionId: inv.subscription_id } });
    return 'cancelled' as InvStatus;
  });
}

export async function sendInvoice(db: DB, id: number, appUrl: string, actor?: Actor) {
  const inv = await getInvoiceRow(db, id);
  if (inv.status !== 'confirmed' && inv.status !== 'paid') throw conflict(`Confirm ${inv.number} before sending it.`);
  const c = await db.prepare('SELECT name, email FROM customers WHERE id = ?').get<{ name: string; email: string }>(inv.customer_id);
  const { company, billing } = await getSettings(db);
  const balance = inv.total - inv.amount_paid;
  const word = docWord(inv);
  await sendMail(db, c!.email, `${word === 'invoice' ? 'Invoice' : 'Credit note'} ${inv.number} from ${company.name}`,
    `Hello ${c!.name},\n\n${word === 'invoice' ? 'Invoice' : 'Credit note'} ${inv.number} for ${formatMoney(inv.total)} is in your account.\n` +
    (word === 'invoice' ? (balance > 0 ? `Amount due: ${formatMoney(balance)} by ${inv.due_date}.\n` : 'It is fully paid. Thank you.\n') : '') +
    (word === 'invoice' && balance > 0 && billing.onlinePayments ? `Pay online by UPI or card: ${appUrl}/portal/invoices/${inv.id}\n` : `\nView it in your portal: ${appUrl}/portal/invoices/${inv.id}\n`) +
    `\n${company.legalName}\n${company.address}\nGSTIN ${company.gstin}\n`, 'invoice');
  await db.query('UPDATE invoices SET sent_at = now() WHERE id = ?', [id]);
  await logActivity(db, { type: 'invoice.sent', entity: 'invoice', entityId: id, customerId: inv.customer_id, actor, message: `${inv.number} emailed to ${c!.email}.` });
}

/** A payment reminder for one overdue invoice; counts reminders so the schedule can space them out. */
export async function remindInvoice(db: DB, id: number, appUrl: string, actor?: Actor) {
  const inv = await getInvoiceRow(db, id);
  if (inv.status !== 'confirmed' || inv.kind === 'credit_note') throw conflict(`${inv.number} has nothing to remind about.`);
  const c = await db.prepare('SELECT name, email FROM customers WHERE id = ?').get<{ name: string; email: string }>(inv.customer_id);
  const { company } = await getSettings(db);
  const balance = inv.total - inv.amount_paid;
  const late = Math.max(0, Math.round((Date.parse(today()) - Date.parse(inv.due_date)) / 864e5));
  await sendMail(db, c!.email, `Reminder: ${inv.number} is ${late ? `${late} day${late === 1 ? '' : 's'} overdue` : 'due'}`,
    `Hello ${c!.name},\n\nThis is a friendly reminder that ${formatMoney(balance)} is still owed on invoice ${inv.number} (due ${inv.due_date}).\n` +
    `Pay online by UPI or card: ${appUrl}/portal/invoices/${inv.id}\n\nIf you have already paid, please ignore this email.\n\n${company.name}`, 'reminder');
  await db.query('UPDATE invoices SET reminder_count = reminder_count + 1, last_reminder_at = now() WHERE id = ?', [id]);
  await logActivity(db, { type: 'invoice.reminded', entity: 'invoice', entityId: id, customerId: inv.customer_id, actor,
    message: `Payment reminder sent for ${inv.number} (${formatMoney(balance)} owed${late ? `, ${late} days late` : ''}).` });
}

export async function invoiceDetail(db: DB, id: number) {
  const inv = await db.prepare(`SELECT i.*, c.name AS customer_name, c.email AS customer_email, c.company AS customer_company, c.address AS customer_address,
      c.gstin AS customer_gstin, s.number AS subscription_number, p.name AS plan_name, s.payment_terms_days, o.number AS origin_number
    FROM invoices i JOIN customers c ON c.id = i.customer_id JOIN subscriptions s ON s.id = i.subscription_id JOIN plans p ON p.id = s.plan_id
    LEFT JOIN invoices o ON o.id = i.origin_invoice_id WHERE i.id = ?`).get(id);
  if (!inv) throw notFound('Invoice');
  const lines = await db.query(`SELECT id, description, quantity, unit_price AS "unitPrice", subtotal, discount, tax_rate AS "taxRate", tax, total
    FROM invoice_lines WHERE invoice_id = ? ORDER BY id`, [id]);
  const payments = await db.query(`SELECT id, kind, method, amount, date, note, provider, provider_ref AS "providerRef" FROM payments WHERE invoice_id = ? ORDER BY date, id`, [id]);
  const credits = await db.query(`SELECT id, number, status, total, invoice_date AS "invoiceDate" FROM invoices WHERE origin_invoice_id = ? AND kind = 'credit_note' ORDER BY id`, [id]);
  return { inv: inv as Record<string, unknown>, lines, payments, credits };
}

/**
 * Issues a credit note against a confirmed or paid invoice. The credit is applied straight away:
 * against the unpaid balance first, and any part already paid is refunded to the customer.
 */
export async function issueCreditNote(db: DB, invoiceId: number, input: { amount?: number | null; reason: string; refundMethod?: string }, actor?: Actor) {
  return db.tx(async (t) => {
    const inv = await getInvoiceRow(t, invoiceId, true);
    if (inv.kind === 'credit_note') throw conflict('A credit note cannot be credited.');
    if (inv.status !== 'confirmed' && inv.status !== 'paid') throw conflict(`${inv.number} is ${inv.status}; only confirmed or paid invoices can be credited.`);
    const already = (await t.prepare(`SELECT coalesce(sum(total), 0) AS v FROM invoices WHERE origin_invoice_id = ? AND kind = 'credit_note' AND status <> 'cancelled'`).get<{ v: number }>(invoiceId))!.v;
    const creditable = inv.total - already;
    const amount = input.amount ?? creditable;
    if (amount <= 0) throw badRequest('Enter an amount above zero.');
    if (amount > creditable) throw conflict(`Only ${formatMoney(creditable)} of ${inv.number} is left to credit.`);
    const r = await creditNoteFor(t, inv, amount, input.reason, input.refundMethod, actor);
    return r;
  });
}

/** Shared by manual credit notes and downgrade proration. Assumes it runs inside a transaction. */
export async function creditNoteFor(t: DB, inv: InvRow, amount: number, reason: string, refundMethod = 'bank_transfer', actor?: Actor) {
  const d = today();
  // Credit lines mirror the invoice's tax mix proportionally, so tax is reversed along with the net amount.
  const src = await t.query<{ description: string; subtotal: number; discount: number; tax_rate: number; total: number; product_id: number | null }>(
    'SELECT description, subtotal, discount, tax_rate, total, product_id FROM invoice_lines WHERE invoice_id = ? ORDER BY id', [inv.id]);
  const gross = src.reduce((a, l) => a + l.total, 0) || inv.total;
  const share = Math.min(1, amount / gross);
  const byRate = new Map<number, number>();
  for (const l of src) byRate.set(Number(l.tax_rate), (byRate.get(Number(l.tax_rate)) ?? 0) + (l.subtotal - l.discount) * share);
  if (byRate.size === 0) byRate.set(0, amount);
  const lines = [...byRate.entries()].map(([rate, net]) => ({
    productId: null, description: `Credit for ${inv.number}${rate ? ` (GST ${rate}%)` : ''}: ${reason}`, quantity: 1, unitPrice: Math.round(net), taxRate: rate,
  }));
  const cn = await insertInvoice(t, { kind: 'credit_note', subscriptionId: inv.subscription_id, customerId: inv.customer_id, periodStart: d, periodEnd: d,
    invoiceDate: d, dueDate: d, lines, originInvoiceId: inv.id, note: reason, status: 'confirmed' });
  // Rounding can move the credit a paisa or two; settle what the note actually totals.
  const value = Math.min(cn.total, inv.total);
  const unpaid = inv.total - inv.amount_paid;
  const applied = Math.min(unpaid, value);
  const refund = value - applied;
  if (applied > 0) {
    await t.query(`INSERT INTO payments (invoice_id, kind, method, amount, date, note, provider, created_by) VALUES (?, 'payment', 'credit_note', ?, ?, ?, 'system', ?)`,
      [inv.id, applied, d, `Credit note ${cn.number}`, actor?.id ?? null]);
    await t.query(`UPDATE invoices SET amount_paid = amount_paid + ?, status = CASE WHEN amount_paid + ? >= total THEN 'paid' ELSE status END WHERE id = ?`, [applied, applied, inv.id]);
  }
  if (refund > 0) {
    const method = ['bank_transfer', 'card', 'upi', 'cash', 'cheque'].includes(refundMethod) ? refundMethod : 'bank_transfer';
    await t.query(`INSERT INTO payments (invoice_id, kind, method, amount, date, note, provider, created_by) VALUES (?, 'refund', ?, ?, ?, ?, 'manual', ?)`,
      [cn.id, method, refund, d, `Refund for ${inv.number}`, actor?.id ?? null]);
  }
  await t.query("UPDATE invoices SET status = 'paid', amount_paid = total WHERE id = ?", [cn.id]);
  await logActivity(t, { type: 'invoice.credited', entity: 'invoice', entityId: inv.id, customerId: inv.customer_id, actor,
    message: `Credit note ${cn.number} for ${formatMoney(cn.total)} issued against ${inv.number}${refund > 0 ? `; ${formatMoney(refund)} refunded` : ''}. Reason: ${reason}`,
    data: { creditNoteId: cn.id, applied, refund, subscriptionId: inv.subscription_id } });
  return { id: cn.id, number: cn.number, total: cn.total, applied, refunded: refund };
}
