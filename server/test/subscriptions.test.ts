import { describe, it, expect } from 'vitest';
import { makeApp, loginAs, catalog, type Catalog } from './helpers';
import { addDays, addPeriods, today } from '../src/domain/periods';

async function setup() {
  const { app, db } = await makeApp();
  const c = await catalog(db);
  const staff = await loginAs(app, 'staff');
  return { app, db, c, staff };
}

const newSub = (c: Catalog, o: Record<string, unknown> = {}) => ({
  customerId: c.acme, planId: c.monthly, startDate: today(), expiryDate: null, paymentTermsDays: 15,
  lines: [{ productId: c.crm, variantId: c.odoo, quantity: 3 }], ...o,
});

describe('quotation templates', () => {
  it('a quote from a template copies plan and lines and sets valid-until', async () => {
    const { c, staff } = await setup();
    const t = await staff.post('/api/templates').send({ name: 'Growth pack', planId: c.monthly, validityDays: 14, paymentTermsDays: 30, termMonths: 12,
      notes: '', lines: [{ productId: c.crm, variantId: c.odoo, quantity: 10 }, { productId: c.storage, variantId: null, quantity: 2 }] });
    expect(t.status).toBe(201);
    const q = await staff.post(`/api/templates/${t.body.id}/quote`).send({ customerId: c.acme, startDate: '2026-11-01' });
    expect(q.status).toBe(201);
    expect(q.body.number).toMatch(/^SUB\/\d{4}\/\d{5}$/);
    const sub = (await staff.get(`/api/subscriptions/${q.body.id}`)).body;
    expect(sub).toMatchObject({ status: 'quotation', planId: c.monthly, paymentTermsDays: 30, validUntil: addDays(today(), 14), expiryDate: '2027-11-01' });
    expect(sub.lines.map((l: { quantity: number }) => l.quantity)).toEqual([10, 2]);
  });
});

describe('subscriptions', () => {
  it('prices a variant line as sales price plus the variant extra', async () => {
    const { c, staff } = await setup();
    const r = await staff.post('/api/subscriptions').send(newSub(c));
    expect(r.status).toBe(201);
    const sub = (await staff.get(`/api/subscriptions/${r.body.id}`)).body;
    expect(sub.lines[0]).toMatchObject({ unitPrice: 206000, quantity: 3, taxId: c.gst, amount: 618000 });
    expect(sub.planTaxName).toBe('GST 18%');
    expect(sub.billing).toMatchObject({ invoiced: 0, paid: 0, owed: 0, credited: 0, overdue: 0 });
    expect(sub.status).toBe('draft');
  });
  it('rejects a quantity below the plan minimum', async () => {
    const { c, staff } = await setup();
    const r = await staff.post('/api/subscriptions').send(newSub(c, { planId: c.yearly, lines: [{ productId: c.crm, variantId: null, quantity: 2 }] }));
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/at least 5/);
  });
  it('rejects a plan that is not available on the start date', async () => {
    const { c, staff } = await setup();
    expect((await staff.post('/api/subscriptions').send(newSub(c, { planId: c.retired }))).status).toBe(409);
  });
  it('rejects an expiry before the start', async () => {
    const { c, staff } = await setup();
    expect((await staff.post('/api/subscriptions').send(newSub(c, { expiryDate: addDays(today(), -1) }))).status).toBe(400);
  });
  it('moves draft → quotation → confirmed → active → closed', async () => {
    const { c, staff, db } = await setup();
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c))).body;
    for (const [action, status] of [['send', 'quotation'], ['confirm', 'confirmed'], ['activate', 'active'], ['close', 'closed']]) {
      const r = await staff.post(`/api/subscriptions/${id}/actions/${action}`);
      expect(r.status, action).toBe(200);
      expect(r.body.status).toBe(status);
      if (action === 'activate') expect((await db.prepare('SELECT next_invoice_date d FROM subscriptions WHERE id = ?').get(id) as { d: string }).d).toBe(today());
    }
  });
  it('refuses a move outside the lifecycle', async () => {
    const { c, staff } = await setup();
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c))).body;
    const r = await staff.post(`/api/subscriptions/${id}/actions/activate`);
    expect(r.status).toBe(409);
  });
  it('refuses to pause when the plan does not allow it', async () => {
    const { c, staff } = await setup();
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c, { planId: c.yearly, lines: [{ productId: c.crm, variantId: null, quantity: 5 }] }))).body;
    for (const a of ['confirm', 'activate']) await staff.post(`/api/subscriptions/${id}/actions/${a}`);
    const r = await staff.post(`/api/subscriptions/${id}/actions/pause`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/pausing/i);
  });
  it('refuses to close early when the plan does not allow it', async () => {
    const { c, staff } = await setup();
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c, { planId: c.yearly, expiryDate: addPeriods(today(), 'yearly', 1),
      lines: [{ productId: c.crm, variantId: null, quantity: 5 }] }))).body;
    for (const a of ['confirm', 'activate']) await staff.post(`/api/subscriptions/${id}/actions/${a}`);
    expect((await staff.post(`/api/subscriptions/${id}/actions/close`)).status).toBe(409);
  });
  it('refuses to confirm a quotation past its validity', async () => {
    const { c, staff, db } = await setup();
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c))).body;
    await staff.post(`/api/subscriptions/${id}/actions/send`);
    await db.prepare('UPDATE subscriptions SET valid_until = ? WHERE id = ?').run(addDays(today(), -1), id);
    const r = await staff.post(`/api/subscriptions/${id}/actions/confirm`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/expired/i);
  });
  it('resuming skips the periods spent paused', async () => {
    const { c, staff, db } = await setup();
    const start = addPeriods(today(), 'monthly', -3);
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c, { startDate: start }))).body;
    for (const a of ['confirm', 'activate', 'pause', 'resume']) await staff.post(`/api/subscriptions/${id}/actions/${a}`);
    const next = (await db.prepare('SELECT next_invoice_date d FROM subscriptions WHERE id = ?').get(id) as { d: string }).d;
    expect(next >= today()).toBe(true);
  });
  it('renewing extends the expiry by the original term', async () => {
    const { c, staff } = await setup();
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c, { startDate: '2026-01-15', expiryDate: '2026-07-15' }))).body;
    for (const a of ['confirm', 'activate']) await staff.post(`/api/subscriptions/${id}/actions/${a}`);
    const r = await staff.post(`/api/subscriptions/${id}/renew`);
    expect(r.status).toBe(200);
    expect((await staff.get(`/api/subscriptions/${id}`)).body.expiryDate).toBe('2027-01-15');
  });
  it('refuses to renew when the plan does not allow it', async () => {
    const { c, staff } = await setup();
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c, { planId: c.fixedTerm, expiryDate: addDays(today(), 28) }))).body;
    for (const a of ['confirm', 'activate']) await staff.post(`/api/subscriptions/${id}/actions/${a}`);
    expect((await staff.post(`/api/subscriptions/${id}/renew`)).status).toBe(409);
  });
  it('lists with filters and pagination', async () => {
    const { c, staff } = await setup();
    await staff.post('/api/subscriptions').send(newSub(c));
    const { id } = (await staff.post('/api/subscriptions').send(newSub(c))).body;
    await staff.post(`/api/subscriptions/${id}/actions/send`);
    const r = await staff.get('/api/subscriptions?status=quotation');
    expect(r.body).toMatchObject({ total: 1, page: 1 });
    expect(r.body.rows[0]).toMatchObject({ id, customerName: 'Acme Ltd', planName: 'Growth Monthly' });
  });
});
