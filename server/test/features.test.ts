import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { makeApp, loginAs, catalog, signupCustomer, type DB, type Catalog } from './helpers';
import { applySubscriptionAction, changeSubscription, createSubscription } from '../src/services/subscriptions';
import { runBilling } from '../src/services/billing';
import { confirmInvoice, issueCreditNote } from '../src/services/invoices';
import { recordPayment, handleRazorpayWebhook } from '../src/services/payments';
import { runDaily } from '../src/services/jobs';
import { saveSettings, DEFAULT_SETTINGS } from '../src/services/settings';
import { visibleTo, type LiveEvent } from '../src/realtime';
import { addDays, today } from '../src/domain/periods';
import { seedInto } from '../src/db/seed';
import { openTestDb } from '../src/db/connection';
import { dashboard } from '../src/services/reports';

const APP_URL = 'https://billing.example.test';

async function running(db: DB, c: Catalog, o: { start?: string; customerId?: number; qty?: number } = {}) {
  const { id } = await createSubscription(db, { customerId: o.customerId ?? c.acme, planId: c.monthly, startDate: o.start ?? addDays(today(), -10), expiryDate: null,
    paymentTermsDays: 15, lines: [{ productId: c.crm, variantId: null, quantity: o.qty ?? 2 }] }, null);
  await applySubscriptionAction(db, id, 'confirm');
  await applySubscriptionAction(db, id, 'activate');
  return id;
}
const invoicesOf = (db: DB, subId: number) => db.query<{ id: number; kind: string; status: string; total: number; amount_paid: number; sent_at: string | null; reminder_count: number }>(
  'SELECT id, kind, status, total, amount_paid, sent_at, reminder_count FROM invoices WHERE subscription_id = ? ORDER BY id', [subId]);

describe('daily automation', () => {
  it('bills, confirms and emails new invoices, and a second run the same day changes nothing', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await running(db, c);
    const first = await runDaily(db, { appUrl: APP_URL, trigger: 'manual' });
    expect(first).toMatchObject({ created: 1, confirmed: 1, sent: 1 });
    const [inv] = await invoicesOf(db, id);
    expect(inv).toMatchObject({ status: 'confirmed' });
    expect(inv.sent_at).not.toBeNull();
    const mail = await db.query<{ subject: string; body: string }>("SELECT subject, body FROM outbox WHERE kind = 'invoice'");
    expect(mail).toHaveLength(1);
    expect(mail[0].body).toContain(`${APP_URL}/portal/invoices/${inv.id}`);
    const second = await runDaily(db, { appUrl: APP_URL, trigger: 'manual' });
    expect(second).toMatchObject({ created: 0, confirmed: 0, sent: 0, reminders: 0 });
    expect((await db.query<{ ok: number }>("SELECT ok FROM job_runs WHERE job = 'daily'")).map((r) => r.ok)).toEqual([1, 1]);
  });

  it('respects settings: drafts stay drafts when auto-confirm is off', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    await saveSettings(db, 'billing', { ...DEFAULT_SETTINGS.billing, autoConfirm: false, autoSend: false });
    const id = await running(db, c);
    expect(await runDaily(db, { appUrl: APP_URL, trigger: 'manual' })).toMatchObject({ created: 1, confirmed: 0, sent: 0 });
    expect((await invoicesOf(db, id))[0].status).toBe('draft');
  });

  it('sends one reminder per configured day after the due date, never twice in a day', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await running(db, c, { start: addDays(today(), -40) });
    await runDaily(db, { appUrl: APP_URL, trigger: 'manual' });
    // The first period (due 25 days ago) is past every reminder day: it receives its catch-up reminder once.
    const before = await invoicesOf(db, id);
    expect(before[0].reminder_count).toBe(1);
    await runDaily(db, { appUrl: APP_URL, trigger: 'manual' });
    expect((await invoicesOf(db, id))[0].reminder_count).toBe(1);
    expect((await db.query("SELECT 1 FROM outbox WHERE kind = 'reminder'")).length).toBe(1);
  });

  it('dunning closes subscriptions with invoices overdue past the limit, with a reason', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    await saveSettings(db, 'billing', { ...DEFAULT_SETTINGS.billing, dunningCloseDays: 10 });
    const late = await running(db, c, { start: addDays(today(), -40) });
    const fresh = await running(db, c, { start: addDays(today(), -3) });
    const r = await runDaily(db, { appUrl: APP_URL, trigger: 'manual' });
    expect(r.dunningClosed).toBe(1);
    const s = await db.query<{ id: number; status: string; reason: string | null }>(`SELECT s.id, s.status, cr.name AS reason FROM subscriptions s LEFT JOIN close_reasons cr ON cr.id = s.close_reason_id ORDER BY s.id`);
    expect(s.find((x) => x.id === late)).toMatchObject({ status: 'closed', reason: 'Unpaid invoices' });
    expect(s.find((x) => x.id === fresh)).toMatchObject({ status: 'active' });
  });
});

describe('upsell and downsell with proration', () => {
  it('an increase mid-period raises a prorated invoice; a decrease issues a prorated credit note', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await running(db, c, { start: addDays(today(), -10), qty: 2 });
    await runBilling(db, today());
    const [period] = await invoicesOf(db, id);
    await confirmInvoice(db, period.id);
    const up = await changeSubscription(db, id, { lines: [{ productId: c.crm, variantId: null, quantity: 5 }] });
    expect(up.newMrr - up.oldMrr).toBe(3 * 150000);
    expect(up.upsell).not.toBeNull();
    expect(up.upsell!.total).toBeGreaterThan(0);
    expect(up.upsell!.total).toBeLessThan(Math.round(3 * 150000 * 1.18));
    const down = await changeSubscription(db, id, { lines: [{ productId: c.crm, variantId: null, quantity: 1 }] });
    expect(down.credit).not.toBeNull();
    expect(down.credit!.applied + down.credit!.refunded).toBe(down.credit!.total);
    const kinds = (await invoicesOf(db, id)).map((i) => i.kind);
    expect(kinds).toEqual(['recurring', 'upsell', 'credit_note']);
    const mrr = await db.query<{ kind: string; delta: number }>('SELECT kind, delta FROM mrr_events WHERE subscription_id = ? ORDER BY id', [id]);
    expect(mrr.map((m) => m.kind)).toEqual(['new', 'expansion', 'contraction']);
    expect(mrr.reduce((a, m) => a + m.delta, 0)).toBe(99900 + 150000);
  });
});

describe('credit notes', () => {
  async function confirmedInvoice() {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const id = await running(db, c);
    await runBilling(db, today());
    const [inv] = await invoicesOf(db, id);
    await confirmInvoice(db, inv.id);
    return { app, db, inv };
  }
  it('against an unpaid invoice the credit settles the balance', async () => {
    const { db, inv } = await confirmedInvoice();
    const cn = await issueCreditNote(db, inv.id, { amount: 10000, reason: 'Goodwill' });
    expect(cn).toMatchObject({ applied: cn.total, refunded: 0 });
    expect(cn.number).toMatch(/^CN\/\d{4}\/00001$/);
    const [after] = await db.query<{ amount_paid: number; status: string }>('SELECT amount_paid, status FROM invoices WHERE id = ?', [inv.id]);
    expect(after).toMatchObject({ amount_paid: cn.total, status: 'confirmed' });
  });
  it('against a paid invoice the credit is refunded and revenue goes down', async () => {
    const { db, inv } = await confirmedInvoice();
    await recordPayment(db, { invoiceId: inv.id, method: 'upi', amount: inv.total, date: today(), note: '' }, null);
    const cn = await issueCreditNote(db, inv.id, { reason: 'Cancelled within 7 days' });
    expect(cn).toMatchObject({ applied: 0, refunded: cn.total });
    const d = await dashboard(db, { from: addDays(today(), -30), to: today() });
    expect(d.revenue).toBe(inv.total - cn.total);
    expect(d.refunds).toBe(cn.total);
    await expect(issueCreditNote(db, inv.id, { amount: 100, reason: 'again' })).rejects.toThrow(/left to credit/);
  });
  it('staff can issue one through the API; customers cannot', async () => {
    const { app, inv } = await confirmedInvoice();
    const staff = await loginAs(app, 'staff');
    const r = await staff.post(`/api/invoices/${inv.id}/credit`).send({ amount: 5000, reason: 'Price match' });
    expect(r.status).toBe(201);
    const { agent } = await signupCustomer(app, 'other@x.test');
    expect((await agent.post(`/api/invoices/${inv.id}/credit`).send({ amount: 5000, reason: 'mine' })).status).toBe(403);
  });
});

describe('self-service order and online payment', () => {
  async function shop() {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const admin = await loginAs(app, 'admin');
    const t = await admin.post('/api/templates').send({ name: 'Starter', planId: c.monthly, validityDays: 30, paymentTermsDays: 0, published: true,
      description: 'For small teams', lines: [{ productId: c.crm, variantId: null, quantity: 2 }] });
    return { app, db, c, templateId: t.body.id as number };
  }
  it('lists published offers publicly, orders one, pays it in the sandbox and the subscription starts', async () => {
    const { app, db, templateId } = await shop();
    const offers = await request(app).get('/api/public/offers');
    expect(offers.body.rows).toHaveLength(1);
    expect(offers.body.rows[0]).toMatchObject({ name: 'Starter', perPeriod: 99900 + 2 * 150000 });
    const { agent } = await signupCustomer(app, 'buyer@x.test', 'Buyer');
    const order = await agent.post(`/api/portal/offers/${templateId}/order`).send({});
    expect(order.status).toBe(201);
    expect((await agent.get(`/api/portal/subscriptions/${order.body.subscriptionId}`)).body.status).toBe('confirmed');
    const chk = await agent.post(`/api/portal/invoices/${order.body.invoiceId}/checkout`);
    expect(chk.body).toMatchObject({ provider: 'sandbox', amount: order.body.total });
    const declined = await agent.post(`/api/portal/checkouts/${chk.body.id}/sandbox`).send({ success: false, method: 'card' });
    expect(declined.body.status).toBe('failed');
    const chk2 = await agent.post(`/api/portal/invoices/${order.body.invoiceId}/checkout`);
    const paid = await agent.post(`/api/portal/checkouts/${chk2.body.id}/sandbox`).send({ success: true, method: 'upi' });
    expect(paid.body.status).toBe('paid');
    const again = await agent.post(`/api/portal/checkouts/${chk2.body.id}/sandbox`).send({ success: true, method: 'upi' });
    expect(again.body.paymentId).toBe(paid.body.paymentId);
    const sub = (await agent.get(`/api/portal/subscriptions/${order.body.subscriptionId}`)).body;
    expect(sub.status).toBe('active');
    expect(sub.nextInvoiceDate).not.toBe(today());
    expect((await db.query('SELECT 1 FROM payments')).length).toBe(1);
    // The next billing run does not bill the first period again.
    expect((await runBilling(db, today())).created).toBe(0);
  });
  it("one customer cannot start or read another customer's checkout", async () => {
    const { app, templateId } = await shop();
    const a = await signupCustomer(app, 'a@x.test');
    const b = await signupCustomer(app, 'b@x.test');
    const order = await a.agent.post(`/api/portal/offers/${templateId}/order`).send({});
    expect((await b.agent.post(`/api/portal/invoices/${order.body.invoiceId}/checkout`)).status).toBe(404);
    const chk = await a.agent.post(`/api/portal/invoices/${order.body.invoiceId}/checkout`);
    expect((await b.agent.get(`/api/portal/checkouts/${chk.body.id}`)).status).toBe(404);
    expect((await b.agent.post(`/api/portal/checkouts/${chk.body.id}/sandbox`).send({ success: true, method: 'upi' })).status).toBe(404);
  });
});

describe('Razorpay webhook', () => {
  afterEach(() => { delete process.env.RAZORPAY_WEBHOOK_SECRET; });
  it('verifies the signature and records the captured payment once', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await running(db, c);
    await runBilling(db, today());
    const [inv] = await invoicesOf(db, id);
    await confirmInvoice(db, inv.id);
    await db.query("INSERT INTO checkouts (id, invoice_id, customer_id, amount, provider, provider_order_id) VALUES ('chk_1', ?, ?, ?, 'razorpay', 'order_ABC')", [inv.id, c.acme, inv.total]);
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_XYZ', order_id: 'order_ABC', method: 'upi' } } } });
    await expect(handleRazorpayWebhook(db, body, 'bad')).rejects.toThrow(/signature/i);
    const sig = createHmac('sha256', 'whsec_test').update(body).digest('hex');
    await handleRazorpayWebhook(db, body, sig);
    await handleRazorpayWebhook(db, body, sig);
    const pays = await db.query<{ amount: number; provider: string; provider_ref: string }>('SELECT amount, provider, provider_ref FROM payments');
    expect(pays).toEqual([{ amount: inv.total, provider: 'razorpay', provider_ref: 'pay_XYZ' }]);
    expect((await db.query<{ status: string }>('SELECT status FROM invoices WHERE id = ?', [inv.id]))[0].status).toBe('paid');
  });
});

describe('live events', () => {
  const e = (o: Partial<LiveEvent>): LiveEvent => ({ id: 1, createdAt: '', type: 'invoice.confirmed', entity: 'invoice', entityId: 1, customerId: 7, actorName: 'x', message: 'm', data: {}, ...o });
  it('staff see everything; a customer sees only their own customer-facing events', async () => {
    const staff = { id: 1, email: '', name: '', role: 'staff' as const, customerId: null };
    const cust = { id: 2, email: '', name: '', role: 'customer' as const, customerId: 7 };
    expect(visibleTo(staff, e({ customerId: 9 }))).toBe(true);
    expect(visibleTo(cust, e({}))).toBe(true);
    expect(visibleTo(cust, e({ customerId: 9 }))).toBe(false);
    expect(visibleTo(cust, e({ entity: 'billing', customerId: 7 }))).toBe(false);
  });
  it('the activity feed is scoped the same way over HTTP', async () => {
    const { app, db } = await makeApp(); const c = await catalog(db);
    await running(db, c);
    const { agent } = await signupCustomer(app, 'nosy@x.test');
    const mine = await agent.get('/api/admin/activity');
    expect(mine.body.rows.every((r: { type: string }) => r.type === 'customer.signed_up')).toBe(true);
    const staff = await loginAs(app, 'staff');
    expect((await staff.get('/api/admin/activity')).body.rows.some((r: { type: string }) => r.type === 'subscription.activated')).toBe(true);
    expect((await request(app).get('/api/live')).status).toBe(401);
  });
});

describe('security guards', () => {
  it('refuses state changes sent from another site', async () => {
    const { app } = await makeApp();
    const r = await request(app).post('/api/auth/login').set('Origin', 'https://evil.example').set('Host', 'billing.example.test').send({ email: 'admin@brightloop.test', password: 'x' });
    expect(r.status).toBe(403);
  });
  it('rate-limits repeated failed sign-ins for one account', async () => {
    const { app } = await makeApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await request(app).post('/api/auth/login').send({ email: 'staff@brightloop.test', password: 'wrong' })).status);
    expect(codes.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
  it('the cron endpoint needs the secret', async () => {
    const { app } = await makeApp();
    process.env.CRON_SECRET = 'cron_test_secret';
    expect((await request(app).get('/api/cron/daily')).status).toBe(401);
    expect((await request(app).get('/api/cron/daily').set('Authorization', 'Bearer cron_test_secret')).status).toBe(200);
    delete process.env.CRON_SECRET;
  });
  it('only admins change settings, and CSV exports neutralise formulas', async () => {
    const { app, db } = await makeApp();
    const staff = await loginAs(app, 'staff');
    expect((await staff.put('/api/admin/settings').send({ billing: { ...DEFAULT_SETTINGS.billing, autoSend: false } })).status).toBe(403);
    const admin = await loginAs(app, 'admin');
    expect((await admin.put('/api/admin/settings').send({ billing: { ...DEFAULT_SETTINGS.billing, autoSend: false } })).body.billing.autoSend).toBe(false);
    await db.query("INSERT INTO customers (name, email) VALUES ('=HYPERLINK(\"x\")', 'f@x.test')");
    const c = await catalog(db);
    await running(db, { ...c, acme: (await db.query<{ id: number }>("SELECT id FROM customers WHERE email = 'f@x.test'"))[0].id });
    const csv = await staff.get('/api/reports/export/subscriptions');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('MRR bridge', () => {
  it('opening + movements = closing, and the last month closes at the live MRR', async () => {
    const db = await openTestDb();
    await seedInto(db, 150);
    const d = await dashboard(db, { from: addDays(today(), -360).slice(0, 8) + '01', to: today() });
    for (const m of d.mrrMonths) expect(m.closing).toBe(m.opening + m.new + m.expansion + m.reactivation + m.contraction + m.churn);
    const last = d.mrrMonths[d.mrrMonths.length - 1];
    // Future-dated activations (start dates ahead) are the only difference allowed.
    const future = (await db.query<{ v: number }>('SELECT coalesce(sum(delta), 0) AS v FROM mrr_events WHERE date > ?', [today()]))[0].v;
    expect(Math.abs(last.closing + future - d.mrr)).toBeLessThan(200);
  }, 120000);
});
