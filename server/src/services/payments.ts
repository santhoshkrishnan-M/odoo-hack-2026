import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db/connection';
import { conflict, notFound, HttpError } from '../http';
import { formatMoney } from '../domain/money';
import { today } from '../domain/periods';
import { getInvoiceRow } from './invoices';
import { logActivity, type Actor } from './activity';
import { activateSubscription } from './subscriptions';
import { sendMail } from './mail';

export type Method = 'bank_transfer' | 'card' | 'upi' | 'cash' | 'cheque' | 'netbanking' | 'wallet';
export const METHODS: Method[] = ['bank_transfer', 'card', 'upi', 'cash', 'cheque', 'netbanking', 'wallet'];

export interface PaymentInput { invoiceId: number; method: Method; amount: number; date: string; note: string; provider?: 'manual' | 'razorpay' | 'sandbox'; providerRef?: string | null }

export async function recordPayment(db: DB, p: PaymentInput, userId: number | null, actor?: Actor): Promise<number> {
  return db.tx(async (t) => {
    const inv = await getInvoiceRow(t, p.invoiceId, true);
    if (inv.kind === 'credit_note') throw conflict('Payments cannot be recorded against a credit note.');
    if (inv.status !== 'confirmed') throw conflict(`${inv.number} is ${inv.status}; payments can only be recorded against confirmed invoices.`);
    const balance = inv.total - inv.amount_paid;
    if (p.amount > balance) throw conflict(`That is more than the ${formatMoney(balance)} still owed on ${inv.number}.`);
    if (p.providerRef) {
      const dup = await t.prepare('SELECT id FROM payments WHERE provider = ? AND provider_ref = ?').get<{ id: number }>(p.provider ?? 'manual', p.providerRef);
      if (dup) return dup.id;
    }
    const r = await t.prepare('INSERT INTO payments (invoice_id, method, amount, date, note, provider, provider_ref, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(p.invoiceId, p.method, p.amount, p.date, p.note, p.provider ?? 'manual', p.providerRef ?? null, userId);
    const paid = inv.amount_paid + p.amount;
    const fully = paid >= inv.total;
    await t.query("UPDATE invoices SET amount_paid = ?, status = CASE WHEN ? THEN 'paid' ELSE status END WHERE id = ?", [paid, fully, p.invoiceId]);
    const online = p.provider === 'razorpay' || p.provider === 'sandbox';
    await logActivity(t, { type: 'payment.received', entity: 'invoice', entityId: inv.id, customerId: inv.customer_id, actor,
      message: `${formatMoney(p.amount)} received${online ? ' online' : ''} on ${inv.number} by ${p.method.replace('_', ' ')}${fully ? ' — paid in full' : ` — ${formatMoney(inv.total - paid)} still owed`}.`,
      data: { paymentId: r.lastInsertRowid, amount: p.amount, fully, subscriptionId: inv.subscription_id, provider: p.provider ?? 'manual' } });
    // A self-service order starts when its first invoice is paid.
    if (fully) {
      const s = await t.prepare("SELECT id, status, source FROM subscriptions WHERE id = ?").get<{ id: number; status: string; source: string }>(inv.subscription_id);
      if (s && s.status === 'confirmed' && s.source === 'portal') await activateSubscription(t, s.id, { id: null, name: 'Online payment' }, { firstInvoiceId: inv.id });
    }
    return r.lastInsertRowid;
  });
}

/* ---------- online checkout: Razorpay when keys are set, otherwise the built-in sandbox ---------- */

export const razorpayEnabled = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
export const paymentProvider = (): 'razorpay' | 'sandbox' => (razorpayEnabled() ? 'razorpay' : 'sandbox');

async function razorpay<T>(path: string, body: unknown): Promise<T> {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com/v1${path}`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json() as T & { error?: { description?: string } };
  if (!res.ok) throw new HttpError(502, `The payment provider refused the request: ${data.error?.description ?? res.status}`);
  return data;
}

export interface CheckoutSession {
  id: string; provider: 'razorpay' | 'sandbox'; amount: number; currency: 'INR'; invoiceNumber: string;
  razorpay?: { keyId: string; orderId: string; name: string; email: string; contact: string; description: string };
}

/** Starts an online payment for the invoice's full open balance. */
export async function createCheckout(db: DB, invoiceId: number, customerId: number): Promise<CheckoutSession> {
  const inv = await getInvoiceRow(db, invoiceId);
  if (inv.customer_id !== customerId) throw notFound('Invoice');
  if (inv.kind === 'credit_note' || inv.status !== 'confirmed') throw conflict(`${inv.number} has nothing left to pay.`);
  const amount = inv.total - inv.amount_paid;
  if (amount <= 0) throw conflict(`${inv.number} has nothing left to pay.`);
  const provider = paymentProvider();
  const id = `chk_${randomBytes(12).toString('hex')}`;
  const c = await db.prepare('SELECT name, email, phone FROM customers WHERE id = ?').get<{ name: string; email: string; phone: string }>(customerId);
  let orderId: string | null = null;
  if (provider === 'razorpay') {
    const order = await razorpay<{ id: string }>('/orders', { amount, currency: 'INR', receipt: id, notes: { invoice: inv.number, checkout: id } });
    orderId = order.id;
  }
  await db.query('UPDATE checkouts SET status = \'expired\' WHERE invoice_id = ? AND status = \'pending\'', [invoiceId]);
  await db.query('INSERT INTO checkouts (id, invoice_id, customer_id, amount, provider, provider_order_id) VALUES (?, ?, ?, ?, ?, ?)', [id, invoiceId, customerId, amount, provider, orderId]);
  return {
    id, provider, amount, currency: 'INR', invoiceNumber: inv.number,
    razorpay: orderId ? { keyId: process.env.RAZORPAY_KEY_ID!, orderId, name: c!.name, email: c!.email, contact: c!.phone, description: `Invoice ${inv.number}` } : undefined,
  };
}

interface CheckoutRow { id: string; invoice_id: number; customer_id: number; amount: number; provider: 'razorpay' | 'sandbox'; provider_order_id: string | null; status: string; payment_id: number | null }

async function getCheckout(db: DB, id: string, customerId?: number): Promise<CheckoutRow> {
  const c = await db.prepare('SELECT * FROM checkouts WHERE id = ?').get<CheckoutRow>(id);
  if (!c || (customerId !== undefined && c.customer_id !== customerId)) throw notFound('Payment');
  return c;
}

/** Marks a checkout paid and records the payment; idempotent, so webhook + browser callback can both arrive. */
export async function completeCheckout(db: DB, checkoutId: string, ref: { method: Method; providerRef: string }, actor?: Actor) {
  return db.tx(async (t) => {
    const c = await t.prepare('SELECT * FROM checkouts WHERE id = ? FOR UPDATE').get<CheckoutRow>(checkoutId);
    if (!c) throw notFound('Payment');
    if (c.status === 'paid') return { status: 'paid' as const, paymentId: c.payment_id, invoiceId: c.invoice_id };
    const inv = await getInvoiceRow(t, c.invoice_id);
    const amount = Math.min(c.amount, inv.total - inv.amount_paid);
    if (inv.status !== 'confirmed' || amount <= 0) {
      await t.query("UPDATE checkouts SET status = 'failed', failure = 'Invoice no longer open', completed_at = now() WHERE id = ?", [c.id]);
      throw conflict(`${inv.number} has nothing left to pay. If you were charged, the payment will be refunded.`);
    }
    const paymentId = await recordPayment(t, { invoiceId: c.invoice_id, method: ref.method, amount, date: today(), note: `${c.provider === 'razorpay' ? 'Razorpay' : 'Sandbox'} ${ref.providerRef}`,
      provider: c.provider, providerRef: ref.providerRef }, null, actor ?? { id: null, name: 'Online payment' });
    await t.query("UPDATE checkouts SET status = 'paid', payment_id = ?, completed_at = now() WHERE id = ?", [paymentId, c.id]);
    const cust = await t.prepare('SELECT name, email FROM customers WHERE id = ?').get<{ name: string; email: string }>(c.customer_id);
    await sendMail(t, cust!.email, `Payment received for ${inv.number}`,
      `Hello ${cust!.name},\n\nWe received ${formatMoney(amount)} for invoice ${inv.number}. Reference: ${ref.providerRef}.\n\nThank you.`, 'receipt');
    return { status: 'paid' as const, paymentId, invoiceId: c.invoice_id };
  });
}

export async function failCheckout(db: DB, checkoutId: string, reason: string, customerId?: number) {
  const c = await getCheckout(db, checkoutId, customerId);
  if (c.status !== 'pending') return;
  await db.query("UPDATE checkouts SET status = 'failed', failure = ?, completed_at = now() WHERE id = ?", [reason.slice(0, 300), c.id]);
  const inv = await getInvoiceRow(db, c.invoice_id);
  await logActivity(db, { type: 'payment.failed', entity: 'invoice', entityId: c.invoice_id, customerId: c.customer_id, actor: { id: null, name: 'Online payment' },
    message: `An online payment of ${formatMoney(c.amount)} for ${inv.number} failed: ${reason}` });
}

/** Sandbox gateway: the hosted test page posts the outcome the payer picked. */
export async function completeSandbox(db: DB, checkoutId: string, customerId: number, outcome: { success: boolean; method: 'upi' | 'card' | 'netbanking' }) {
  const c = await getCheckout(db, checkoutId, customerId);
  if (c.provider !== 'sandbox') throw conflict('This payment is handled by Razorpay.');
  if (!outcome.success) { await failCheckout(db, checkoutId, 'Declined in the test gateway', customerId); return { status: 'failed' as const, invoiceId: c.invoice_id }; }
  return completeCheckout(db, checkoutId, { method: outcome.method, providerRef: `pay_test_${randomBytes(7).toString('hex')}` });
}

const hmac = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');
const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Browser callback after Razorpay Checkout: verify order|payment signature with the key secret. */
export async function verifyRazorpay(db: DB, checkoutId: string, customerId: number, p: { orderId: string; paymentId: string; signature: string; method?: string }) {
  const c = await getCheckout(db, checkoutId, customerId);
  if (c.provider !== 'razorpay' || c.provider_order_id !== p.orderId) throw conflict('This payment does not match the order.');
  if (!sameHex(hmac(process.env.RAZORPAY_KEY_SECRET!, `${p.orderId}|${p.paymentId}`), p.signature)) throw new HttpError(400, 'The payment signature did not verify.');
  return completeCheckout(db, checkoutId, { method: mapMethod(p.method), providerRef: p.paymentId });
}

const mapMethod = (m?: string): Method => (m === 'upi' ? 'upi' : m === 'card' ? 'card' : m === 'netbanking' ? 'netbanking' : m === 'wallet' ? 'wallet' : 'upi');

/** Razorpay webhook (payment.captured / order.paid / payment.failed), verified with RAZORPAY_WEBHOOK_SECRET. */
export async function handleRazorpayWebhook(db: DB, rawBody: string, signature: string | undefined) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'Webhooks are not configured.');
  if (!signature || !sameHex(hmac(secret, rawBody), signature)) throw new HttpError(400, 'Bad signature.');
  const evt = JSON.parse(rawBody) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string; method?: string; error_description?: string } } } };
  const pay = evt.payload?.payment?.entity;
  if (!pay?.order_id) return { ignored: true };
  const c = await db.prepare('SELECT id FROM checkouts WHERE provider_order_id = ?').get<{ id: string }>(pay.order_id);
  if (!c) return { ignored: true };
  if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
    await completeCheckout(db, c.id, { method: mapMethod(pay.method), providerRef: pay.id }).catch((e) => { if (!(e instanceof HttpError)) throw e; });
    return { ok: true };
  }
  if (evt.event === 'payment.failed') { await failCheckout(db, c.id, pay.error_description ?? 'Payment failed'); return { ok: true }; }
  return { ignored: true };
}

export async function checkoutStatus(db: DB, checkoutId: string, customerId: number) {
  const c = await getCheckout(db, checkoutId, customerId);
  const inv = await getInvoiceRow(db, c.invoice_id);
  return { id: c.id, status: c.status, provider: c.provider, amount: c.amount, invoiceId: c.invoice_id, invoiceNumber: inv.number };
}
