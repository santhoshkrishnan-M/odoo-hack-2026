import { describe, it, expect } from 'vitest';
import { makeApp, loginAs } from './helpers';

const product = { name: 'Brightloop CRM', type: 'service', salesPrice: 150000, costPrice: 20000, notes: '', taxId: null,
  variants: [{ attribute: 'Brand', value: 'Odoo', extraPrice: 56000 }] };
const plan = { name: 'Growth Monthly', price: 99900, period: 'monthly', minQuantity: 1, startDate: '2026-01-01', endDate: null,
  autoClose: false, closable: true, pausable: true, renewable: true, taxId: null };

describe('products and variants', () => {
  it('only the admin can create a product', async () => {
    const { app } = await makeApp();
    const staff = await loginAs(app, 'staff');
    expect((await staff.post('/api/products').send(product)).status).toBe(403);
  });
  it('stores variants with their extra price', async () => {
    const { app } = await makeApp();
    const admin = await loginAs(app, 'admin');
    const res = await admin.post('/api/products').send(product);
    expect(res.status).toBe(201);
    const got = await admin.get(`/api/products/${res.body.id}`);
    expect(got.body.variants).toEqual([expect.objectContaining({ attribute: 'Brand', value: 'Odoo', extraPrice: 56000 })]);
  });
  it('staff can read products', async () => {
    const { app } = await makeApp();
    const admin = await loginAs(app, 'admin');
    await admin.post('/api/products').send(product);
    const staff = await loginAs(app, 'staff');
    const list = await staff.get('/api/products');
    expect(list.body.rows).toHaveLength(1);
  });
  it('rejects a negative price', async () => {
    const { app } = await makeApp();
    const admin = await loginAs(app, 'admin');
    expect((await admin.post('/api/products').send({ ...product, salesPrice: -1 })).status).toBe(400);
  });
});

describe('plans', () => {
  it('rejects an end date before the start date', async () => {
    const { app } = await makeApp();
    const admin = await loginAs(app, 'admin');
    const res = await admin.post('/api/plans').send({ ...plan, endDate: '2025-12-31' });
    expect(res.status).toBe(400);
    expect(res.body.fields.endDate).toBeDefined();
  });
  it('creates and updates a plan', async () => {
    const { app } = await makeApp();
    const admin = await loginAs(app, 'admin');
    const res = await admin.post('/api/plans').send(plan);
    expect(res.status).toBe(201);
    const upd = await admin.put(`/api/plans/${res.body.id}`).send({ ...plan, pausable: false });
    expect(upd.status).toBe(200);
    expect((await admin.get(`/api/plans/${res.body.id}`)).body.pausable).toBe(false);
  });
});

describe('taxes', () => {
  it('only the admin creates taxes, staff can list them', async () => {
    const { app } = await makeApp();
    const staff = await loginAs(app, 'staff');
    expect((await staff.post('/api/taxes').send({ name: 'GST 18%', rate: 18 })).status).toBe(403);
    const admin = await loginAs(app, 'admin');
    expect((await admin.post('/api/taxes').send({ name: 'GST 18%', rate: 18 })).status).toBe(201);
    expect((await staff.get('/api/taxes')).body.rows).toHaveLength(1);
  });
});

describe('discounts', () => {
  const discount = { name: 'Volume 10%', type: 'percent', value: 10, minAmount: 0, minQuantity: 10, startDate: '2026-01-01',
    endDate: '2026-12-31', usageLimit: 100, scope: 'subscriptions', productIds: [], subscriptionIds: [] };
  it('only the admin creates discount rules', async () => {
    const { app } = await makeApp();
    const staff = await loginAs(app, 'staff');
    expect((await staff.post('/api/discounts').send(discount)).status).toBe(403);
    const admin = await loginAs(app, 'admin');
    expect((await admin.post('/api/discounts').send(discount)).status).toBe(201);
  });
  it('rejects a percentage over 100', async () => {
    const { app } = await makeApp();
    const admin = await loginAs(app, 'admin');
    expect((await admin.post('/api/discounts').send({ ...discount, value: 150 })).status).toBe(400);
  });
  it('requires products for a product-scoped rule', async () => {
    const { app } = await makeApp();
    const admin = await loginAs(app, 'admin');
    expect((await admin.post('/api/discounts').send({ ...discount, scope: 'products' })).status).toBe(400);
  });
});

describe('customers', () => {
  it('staff create and search customers with pagination', async () => {
    const { app } = await makeApp();
    const staff = await loginAs(app, 'staff');
    await staff.post('/api/customers').send({ name: 'Acme Ltd', email: 'ops@acme.test' });
    await staff.post('/api/customers').send({ name: 'Zenith', email: 'z@zen.test' });
    const res = await staff.get('/api/customers?q=acme');
    expect(res.body).toMatchObject({ total: 1, page: 1, pageSize: 50 });
    expect(res.body.rows[0].name).toBe('Acme Ltd');
  });
});
