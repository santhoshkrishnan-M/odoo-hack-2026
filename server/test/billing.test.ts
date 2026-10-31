import { describe, it, expect } from 'vitest';
import { makeApp, loginAs, catalog, type DB, type Catalog } from './helpers';
import { runBilling } from '../src/services/billing';
import { applySubscriptionAction, createSubscription, type SubscriptionInput } from '../src/services/subscriptions';

async function activeSub(db: DB, c: Catalog, o: Partial<SubscriptionInput> = {}) {
  await db.prepare("UPDATE plans SET start_date = NULL, end_date = NULL").run();
  const { id } = await createSubscription(db, { customerId: c.acme, planId: c.monthly, startDate: '2026-01-15', expiryDate: null, paymentTermsDays: 15,
    lines: [{ productId: c.crm, variantId: c.odoo, quantity: 3 }], ...o }, null);
  await applySubscriptionAction(db, id, 'confirm');
  await applySubscriptionAction(db, id, 'activate');
  return id;
}
const invoices = async (db: DB, subId?: number) => await db.prepare(`SELECT * FROM invoices ${subId ? 'WHERE subscription_id = ' + subId : ''} ORDER BY period_start, id`).all() as
  { id: number; period_start: string; period_end: string; invoice_date: string; due_date: string; status: string; subtotal: number; discount_total: number; tax_total: number; total: number }[];
const addDiscount = async (db: DB, limit: number | null) =>
  (await db.prepare("INSERT INTO discounts (name, type, value, scope, usage_limit) VALUES ('Launch', 'fixed', 50000, 'subscriptions', ?)").run(limit)).lastInsertRowid;

describe('runBilling', () => {
  it('creates one invoice per due period, catching up missed ones', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await activeSub(db, c);
    expect(await runBilling(db, '2026-03-20')).toEqual({ created: 3, closed: 0 });
    expect((await invoices(db, id)).map((i) => [i.period_start, i.period_end, i.due_date])).toEqual([
      ['2026-01-15', '2026-02-15', '2026-01-30'], ['2026-02-15', '2026-03-15', '2026-03-02'], ['2026-03-15', '2026-04-15', '2026-03-30']]);
  });
  it('bills nothing twice when run again', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    await activeSub(db, c);
    await runBilling(db, '2026-03-20');
    expect(await runBilling(db, '2026-03-20')).toEqual({ created: 0, closed: 0 });
  });
  it('fills in the plan fee, product lines, taxes and totals', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await activeSub(db, c);
    await runBilling(db, '2026-01-15');
    const [inv] = await invoices(db, id);
    expect(inv).toMatchObject({ status: 'draft', subtotal: 717900, discount_total: 0, tax_total: 129222, total: 847122 });
    const lines = await db.prepare('SELECT description, quantity, unit_price, tax_rate FROM invoice_lines WHERE invoice_id = ? ORDER BY id').all(inv.id);
    expect(lines).toEqual([
      { description: 'Growth Monthly (2026-01-15 to 2026-02-14)', quantity: 1, unit_price: 99900, tax_rate: 18 },
      { description: 'Brightloop CRM (Brand: Odoo)', quantity: 3, unit_price: 206000, tax_rate: 18 },
    ]);
  });
  it('bills daily plans every day', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    await db.prepare("UPDATE plans SET period = 'daily' WHERE id = ?").run(c.monthly);
    const id = await activeSub(db, c, { startDate: '2026-03-01' });
    await runBilling(db, '2026-03-05');
    expect(await invoices(db, id)).toHaveLength(5);
  });
  it('skips drafts and paused subscriptions', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await activeSub(db, c);
    await applySubscriptionAction(db, id, 'pause');
    await createSubscription(db, { customerId: c.acme, planId: c.monthly, startDate: '2026-01-15', expiryDate: null, paymentTermsDays: 15, lines: [{ productId: c.crm, variantId: null, quantity: 1 }] }, null);
    expect((await runBilling(db, '2026-03-20')).created).toBe(0);
  });
  it('closes auto-close plans at expiry and never bills past it', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await activeSub(db, c, { planId: c.fixedTerm, startDate: '2026-01-01', expiryDate: '2026-01-22' });
    expect(await runBilling(db, '2026-02-01')).toEqual({ created: 3, closed: 1 });
    expect((await db.prepare('SELECT status FROM subscriptions WHERE id = ?').get(id) as { status: string }).status).toBe('closed');
  });
  it('stops billing at expiry for plans that do not auto-close', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const id = await activeSub(db, c, { expiryDate: '2026-03-15' });
    expect(await runBilling(db, '2026-06-01')).toEqual({ created: 2, closed: 0 });
    expect((await db.prepare('SELECT status FROM subscriptions WHERE id = ?').get(id) as { status: string }).status).toBe('active');
  });
  it('applies a discount until its usage limit runs out, and a cancel gives the use back', async () => {
    const { db, app } = await makeApp(); const c = await catalog(db);
    const d = await addDiscount(db, 2);
    for (let i = 0; i < 5; i++) await activeSub(db, c);
    await runBilling(db, '2026-01-15');
    const all = await invoices(db);
    expect(all.filter((i) => i.discount_total > 0)).toHaveLength(2);
    expect(await db.prepare('SELECT used_count FROM discounts WHERE id = ?').get(d)).toEqual({ used_count: 2 });
    const staff = await loginAs(app, 'staff');
    const discounted = all.find((i) => i.discount_total > 0)!;
    expect((await staff.post(`/api/invoices/${discounted.id}/cancel`)).status).toBe(200);
    expect(await db.prepare('SELECT used_count FROM discounts WHERE id = ?').get(d)).toEqual({ used_count: 1 });
  });
  it('ignores a discount outside its dates', async () => {
    const { db } = await makeApp(); const c = await catalog(db);
    const d = await addDiscount(db, null);
    await db.prepare("UPDATE discounts SET end_date = '2026-01-31' WHERE id = ?").run(d);
    const id = await activeSub(db, c);
    await runBilling(db, '2026-02-20');
    expect((await invoices(db, id)).map((i) => i.discount_total > 0)).toEqual([true, false]);
  });
});

describe('billing over HTTP', () => {
  it('two runs at the same moment still bill each period once', async () => {
    const { db, app } = await makeApp(); const c = await catalog(db);
    await activeSub(db, c);
    const staff = await loginAs(app, 'staff');
    const [a, b] = await Promise.all([staff.post('/api/billing/run').send({ asOf: '2026-03-20' }), staff.post('/api/billing/run').send({ asOf: '2026-03-20' })]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.created + b.body.created).toBe(3);
    expect(await invoices(db)).toHaveLength(3);
  });
  it('customers cannot run billing', async () => {
    const { app } = await makeApp();
    const { signupCustomer } = await import('./helpers');
    const { agent } = await signupCustomer(app, 'x@x.test');
    expect((await agent.post('/api/billing/run').send({})).status).toBe(403);
  });
});

describe('invoice actions', () => {
  async function billed() {
    const { db, app } = await makeApp(); const c = await catalog(db);
    await activeSub(db, c);
    await runBilling(db, '2026-02-20');
    const staff = await loginAs(app, 'staff');
    return { db, staff, ids: (await invoices(db)).map((i) => i.id) };
  }
  it('confirms a draft once', async () => {
    const { staff, ids } = await billed();
    const r = await staff.post(`/api/invoices/${ids[0]}/confirm`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('confirmed');
    expect((await staff.post(`/api/invoices/${ids[0]}/confirm`)).status).toBe(409);
  });
  it('sends only confirmed invoices, and writes the email', async () => {
    const { staff, ids, db } = await billed();
    expect((await staff.post(`/api/invoices/${ids[0]}/send`)).status).toBe(409);
    await staff.post(`/api/invoices/${ids[0]}/confirm`);
    expect((await staff.post(`/api/invoices/${ids[0]}/send`)).status).toBe(200);
    const mail = await db.prepare('SELECT to_email, subject FROM outbox').get() as { to_email: string; subject: string };
    expect(mail.to_email).toBe('ops@acme.test');
    expect(mail.subject).toMatch(/INV\/\d{4}\/\d{5}/);
  });
  it('confirms and sends in bulk, reporting the ones it could not do', async () => {
    const { staff, ids } = await billed();
    await staff.post(`/api/invoices/${ids[0]}/cancel`);
    const r = await staff.post('/api/invoices/bulk').send({ ids, action: 'confirm' });
    expect(r.body.done).toBe(1);
    expect(r.body.failed).toEqual([expect.objectContaining({ id: ids[0] })]);
  });
  it('shows the invoice with its lines and customer', async () => {
    const { staff, ids } = await billed();
    const r = await staff.get(`/api/invoices/${ids[0]}`);
    expect(r.body).toMatchObject({ customerName: 'Acme Ltd', status: 'draft' });
    expect(r.body.lines).toHaveLength(2);
    expect(r.body.payments).toEqual([]);
  });
});
