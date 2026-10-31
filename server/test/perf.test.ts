import { describe, it, expect, beforeAll } from 'vitest';
import { makeApp, loginAs, type DB } from './helpers';
import { seed } from '../src/db/seed';
import type { App } from '../src/app';

describe('performance with thousands of subscriptions', () => {
  let app: App; let db: DB;
  beforeAll(async () => {
    ({ app, db } = await makeApp());
    await seed(db, { subscriptions: 3000, today: '2026-10-31', withUsers: false });
  }, 420000);

  it('seeded thousands of subscriptions and their invoices', async () => {
    expect((await db.prepare('SELECT count(*) n FROM subscriptions').get() as { n: number }).n).toBeGreaterThanOrEqual(3000);
    expect((await db.prepare('SELECT count(*) n FROM invoices').get() as { n: number }).n).toBeGreaterThan(10000);
  });

  for (const path of ['/api/reports/dashboard', '/api/subscriptions?page=1', '/api/subscriptions?status=active&page=20', '/api/invoices?overdue=1',
    '/api/invoices?q=INV', '/api/customers?q=a', '/api/payments?page=3']) {
    it(`${path} answers in under 2 seconds`, async () => {
      const staff = await loginAs(app, 'staff');
      const t = performance.now();
      const r = await staff.get(path);
      const ms = performance.now() - t;
      expect(r.status).toBe(200);
      expect(ms).toBeLessThan(2000);
    });
  }
});
