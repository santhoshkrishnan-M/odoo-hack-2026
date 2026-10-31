import { describe, it, expect } from 'vitest';
import { makeApp, loginAs, catalog, signupCustomer, type DB, type Catalog } from './helpers';
import { runBilling } from '../src/services/billing';
import { applySubscriptionAction, createSubscription } from '../src/services/subscriptions';
import { confirmInvoice } from '../src/services/invoices';
import { addDays, today } from '../src/domain/periods';

async function billedInvoice(db: DB, customerId: number, c: Catalog, start = addDays(today(), -40)) {
  const { id } = await createSubscription(db, { customerId, planId: c.monthly, startDate: start, expiryDate: null, paymentTermsDays: 15,
    lines: [{ productId: c.storage, variantId: null, quantity: 1 }] }, null);
  await applySubscriptionAction(db, id, 'confirm');
  await applySubscriptionAction(db, id, 'activate');
  await runBilling(db, today());
  const inv = await db.prepare('SELECT id, total FROM invoices WHERE subscription_id = ? ORDER BY period_start LIMIT 1').get(id) as { id: number; total: number };
  return { subId: id, invoiceId: inv.id, total: inv.total };
}

describe('payments', () => {
  it('a partial then a final payment marks the invoice paid', async () => {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const { invoiceId, total } = await billedInvoice(db, c.acme, c);
    await confirmInvoice(db, invoiceId);
    const staff = await loginAs(app, 'staff');
    const first = await staff.post('/api/payments').send({ invoiceId, method: 'upi', amount: 10000, date: today(), note: 'part' });
    expect(first.status).toBe(201);
    expect((await staff.get(`/api/invoices/${invoiceId}`)).body).toMatchObject({ status: 'confirmed', amountPaid: 10000, balance: total - 10000 });
    await staff.post('/api/payments').send({ invoiceId, method: 'bank_transfer', amount: total - 10000, date: today(), note: '' });
    expect((await staff.get(`/api/invoices/${invoiceId}`)).body).toMatchObject({ status: 'paid', balance: 0 });
  });
  it('rejects a payment larger than the balance and records nothing', async () => {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const { invoiceId, total } = await billedInvoice(db, c.acme, c);
    await confirmInvoice(db, invoiceId);
    const staff = await loginAs(app, 'staff');
    const r = await staff.post('/api/payments').send({ invoiceId, method: 'card', amount: total + 1, date: today(), note: '' });
    expect(r.status).toBe(409);
    expect(await db.prepare('SELECT count(*) n FROM payments').get()).toEqual({ n: 0 });
  });
  it('rejects a payment on a draft invoice', async () => {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const { invoiceId } = await billedInvoice(db, c.acme, c);
    const staff = await loginAs(app, 'staff');
    expect((await staff.post('/api/payments').send({ invoiceId, method: 'cash', amount: 100, date: today(), note: '' })).status).toBe(409);
  });
  it('lists payments with the invoice and customer', async () => {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const { invoiceId } = await billedInvoice(db, c.acme, c);
    await confirmInvoice(db, invoiceId);
    const staff = await loginAs(app, 'staff');
    await staff.post('/api/payments').send({ invoiceId, method: 'cheque', amount: 500, date: today(), note: 'cheque 1234' });
    const r = await staff.get('/api/payments');
    expect(r.body.rows[0]).toMatchObject({ method: 'cheque', amount: 500, customerName: 'Acme Ltd', note: 'cheque 1234' });
  });
});

describe('overdue and the dashboard', () => {
  it('shows a confirmed invoice past its due date as overdue', async () => {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const { invoiceId, total } = await billedInvoice(db, c.acme, c);
    await confirmInvoice(db, invoiceId);
    const staff = await loginAs(app, 'staff');
    const list = await staff.get('/api/invoices?overdue=1');
    expect(list.body.rows.map((r: { id: number }) => r.id)).toEqual([invoiceId]);
    const d = (await staff.get(`/api/reports/dashboard?from=${addDays(today(), -365)}&to=${today()}`)).body;
    expect(d).toMatchObject({ overdueCount: 1, overdueAmount: total, outstanding: total, activeSubscriptions: 1 });
  });
  it('splits what is owed into ageing buckets that sum to the outstanding total', async () => {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const { invoiceId, total } = await billedInvoice(db, c.acme, c);
    await confirmInvoice(db, invoiceId);
    const staff = await loginAs(app, 'staff');
    const d = (await staff.get('/api/reports/dashboard')).body;
    const sum = d.ageing.reduce((a: number, b: { amount: number }) => a + b.amount, 0);
    expect(sum).toBe(d.outstanding);
    expect(d.ageing.map((b: { key: string }) => b.key)).toEqual(['current', '1-30', '31-60', '61-90', '90+']);
    const late = d.ageing.find((b: { key: string }) => b.key === '1-30');
    expect(late).toMatchObject({ amount: total, count: 1 });
  });
  it('counts revenue as the payments received in the range', async () => {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const { invoiceId } = await billedInvoice(db, c.acme, c);
    await confirmInvoice(db, invoiceId);
    const staff = await loginAs(app, 'staff');
    await staff.post('/api/payments').send({ invoiceId, method: 'upi', amount: 12345, date: today(), note: '' });
    await staff.post('/api/payments').send({ invoiceId, method: 'upi', amount: 100, date: addDays(today(), -400), note: '' });
    const d = (await staff.get(`/api/reports/dashboard?from=${addDays(today(), -30)}&to=${today()}`)).body;
    expect(d.revenue).toBe(12345);
    expect(d.mrr).toBe(99900 + 20000);
  });
});

describe('customer portal', () => {
  async function twoCustomers() {
    const { app, db } = await makeApp(); const c = await catalog(db);
    const a = await signupCustomer(app, 'a@a.test', 'Alpha');
    const b = await signupCustomer(app, 'b@b.test', 'Beta');
    const ia = await billedInvoice(db, a.user.customerId, c);
    const ib = await billedInvoice(db, b.user.customerId, c);
    await confirmInvoice(db, ia.invoiceId);
    await confirmInvoice(db, ib.invoiceId);
    return { app, db, c, a, b, ia, ib };
  }
  it('a customer sees only their own subscriptions and invoices', async () => {
    const { a, ia } = await twoCustomers();
    const subs = (await a.agent.get('/api/portal/subscriptions')).body.rows;
    expect(subs.map((s: { id: number }) => s.id)).toEqual([ia.subId]);
    const invs = (await a.agent.get('/api/portal/invoices')).body.rows;
    expect(invs.every((i: { id: number }) => i.id !== undefined)).toBe(true);
    expect(invs.map((i: { id: number }) => i.id)).toContain(ia.invoiceId);
  });
  it("another customer's records are not found", async () => {
    const { a, ia, ib } = await twoCustomers();
    expect((await a.agent.get(`/api/portal/invoices/${ia.invoiceId}`)).status).toBe(200);
    expect((await a.agent.get(`/api/portal/subscriptions/${ia.subId}`)).status).toBe(200);
    expect((await a.agent.get(`/api/portal/invoices/${ib.invoiceId}`)).status).toBe(404);
    expect((await a.agent.get(`/api/portal/subscriptions/${ib.subId}`)).status).toBe(404);
    expect((await a.agent.post(`/api/portal/subscriptions/${ib.subId}/actions/pause`)).status).toBe(404);
  });
  it('hides draft invoices from the customer', async () => {
    const { a, db, ia } = await twoCustomers();
    const draft = await db.prepare("SELECT id FROM invoices WHERE subscription_id = ? AND status = 'draft' LIMIT 1").get(ia.subId) as { id: number };
    expect((await a.agent.get(`/api/portal/invoices/${ia.invoiceId}`)).status).toBe(200);
    expect((await a.agent.get(`/api/portal/invoices/${draft.id}`)).status).toBe(404);
  });
  it('a customer cannot reach staff endpoints', async () => {
    const { a } = await twoCustomers();
    expect((await a.agent.get('/api/invoices')).status).toBe(403);
    expect((await a.agent.get('/api/customers')).status).toBe(403);
    expect((await a.agent.get('/api/reports/dashboard')).status).toBe(403);
  });
  it('a customer accepts a quotation and pauses a running subscription', async () => {
    const { a, db, c, ia } = await twoCustomers();
    const { id } = await createSubscription(db, { customerId: a.user.customerId, planId: c.monthly, startDate: today(), expiryDate: null, paymentTermsDays: 15,
      lines: [{ productId: c.storage, variantId: null, quantity: 1 }] }, null, 'quotation');
    const acc = await a.agent.post(`/api/portal/subscriptions/${id}/actions/accept`);
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe('confirmed');
    const p = await a.agent.post(`/api/portal/subscriptions/${ia.subId}/actions/pause`);
    expect(p.body.status).toBe('paused');
    expect((await a.agent.post(`/api/portal/subscriptions/${ia.subId}/actions/activate`)).status).toBe(404);
  });
  it('a customer updates their profile', async () => {
    const { a } = await twoCustomers();
    expect((await a.agent.put('/api/portal/profile').send({ name: 'Alpha Co', phone: '99999', company: 'Alpha', address: 'Chennai' })).status).toBe(200);
    expect((await a.agent.get('/api/portal/profile')).body).toMatchObject({ name: 'Alpha Co', phone: '99999', email: 'a@a.test' });
  });
});
