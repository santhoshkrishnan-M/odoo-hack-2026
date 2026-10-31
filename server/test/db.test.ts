import { describe, it, expect } from 'vitest';
import { numbered, openTestDb, type DB } from '../src/db/connection';
import { nextNumber } from '../src/services/numbering';

async function fixture() {
  const db = await openTestDb();
  await db.prepare("INSERT INTO customers (name, email) VALUES ('Acme', 'a@acme.test')").run();
  await db.prepare("INSERT INTO plans (name, price, period) VALUES ('Monthly', 100000, 'monthly')").run();
  await db.prepare("INSERT INTO subscriptions (number, customer_id, plan_id, status, start_date) VALUES ('SUB/2026/00001', 1, 1, 'active', '2026-01-01')").run();
  return db;
}
const insertInvoice = (db: DB, number: string, status: string, kind = 'recurring') =>
  db.prepare(`INSERT INTO invoices (number, kind, subscription_id, customer_id, status, period_start, period_end, invoice_date, due_date)
              VALUES (?, ?, 1, 1, ?, '2026-01-01', '2026-02-01', '2026-01-01', '2026-01-01')`).run(number, kind, status);

describe('placeholders', () => {
  it('numbers question marks outside quoted strings', async () => {
    expect(numbered("SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2");
  });
});

describe('nextNumber', () => {
  it('counts per kind and year', async () => {
    const db = await openTestDb();
    expect(await nextNumber(db, 'SUB', 2026)).toBe('SUB/2026/00001');
    expect(await nextNumber(db, 'SUB', 2026)).toBe('SUB/2026/00002');
    expect(await nextNumber(db, 'INV', 2026)).toBe('INV/2026/00001');
    expect(await nextNumber(db, 'SUB', 2027)).toBe('SUB/2027/00001');
  });
  it('never hands out the same number to concurrent callers', async () => {
    const db = await openTestDb();
    const all = await Promise.all(Array.from({ length: 25 }, () => nextNumber(db, 'INV', 2026)));
    expect(new Set(all).size).toBe(25);
  });
});

describe('double billing guard', () => {
  it('rejects a second live invoice for the same period', async () => {
    const db = await fixture();
    await insertInvoice(db, 'INV/1', 'draft');
    await expect(insertInvoice(db, 'INV/2', 'confirmed')).rejects.toThrow(/invoices_one_per_period/);
  });
  it('allows re-billing a period whose invoice was cancelled', async () => {
    const db = await fixture();
    await insertInvoice(db, 'INV/1', 'cancelled');
    await expect(insertInvoice(db, 'INV/2', 'draft')).resolves.toBeTruthy();
  });
  it('allows an upsell invoice in a period that is already billed', async () => {
    const db = await fixture();
    await insertInvoice(db, 'INV/1', 'confirmed');
    await expect(insertInvoice(db, 'INV/2', 'confirmed', 'upsell')).resolves.toBeTruthy();
  });
});

describe('schema checks', () => {
  it('rejects an unknown subscription status', async () => {
    const db = await fixture();
    await expect(db.prepare("UPDATE subscriptions SET status = 'archived'").run()).rejects.toThrow(/check constraint/);
  });
  it('enforces unique emails', async () => {
    const db = await openTestDb();
    const add = () => db.prepare("INSERT INTO users (email, password_hash, name, role) VALUES ('a@b.c','x','A','admin')").run();
    await add();
    await expect(add()).rejects.toThrow(/unique constraint/);
  });
  it('rolls back a failed transaction completely', async () => {
    const db = await fixture();
    await expect(db.tx(async (t) => {
      await t.query("INSERT INTO customers (name, email) VALUES ('Ghost', 'g@x.test')");
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect((await db.query<{ n: number }>("SELECT count(*) AS n FROM customers WHERE name = 'Ghost'"))[0].n).toBe(0);
  });
});
