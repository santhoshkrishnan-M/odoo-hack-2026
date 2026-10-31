import { describe, it, expect } from 'vitest';
import { openTestDb, migrate } from '../src/db/connection';
import { seedInto } from '../src/db/seed';
import { SCHEMA_VERSION } from '../src/db/schema';

describe('first start', () => {
  it('creates the schema, seeds a demo company once, and re-running migrate is a no-op', async () => {
    const db = await openTestDb();
    expect((await db.query<{ version: number }>('SELECT version FROM schema_meta'))[0].version).toBe(SCHEMA_VERSION);
    await seedInto(db, 40);
    expect((await db.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin'").get<{ n: number }>())!.n).toBe(1);
    expect((await db.prepare('SELECT count(*) AS n FROM subscriptions').get<{ n: number }>())!.n).toBe(40);
    await migrate(db);
    expect((await db.prepare('SELECT count(*) AS n FROM subscriptions').get<{ n: number }>())!.n).toBe(40);
    expect((await db.prepare('SELECT count(*) AS n FROM close_reasons').get<{ n: number }>())!.n).toBeGreaterThan(5);
  }, 60000);
});

describe('loading the demo company into a remote PostgreSQL', () => {
  it('builds it locally and bulk-copies every table, keeping ids and sequences consistent', async () => {
    const { openPglite } = await import('../src/db/connection');
    const target = await openPglite();
    await migrate(target);
    const r = await seedInto(target, 60, { viaCopy: true });
    expect(r).toHaveProperty('counts');
    const n = async (sql: string) => (await target.query<{ n: number }>(sql))[0].n;
    expect(await n('SELECT count(*) AS n FROM subscriptions')).toBe(60);
    expect(await n('SELECT count(*) AS n FROM invoices')).toBeGreaterThan(0);
    expect(await n('SELECT count(*) AS n FROM invoice_lines l LEFT JOIN invoices i ON i.id = l.invoice_id WHERE i.id IS NULL')).toBe(0);
    // Sequences continue after the copied ids, so new rows do not collide.
    const before = await n('SELECT max(id) AS n FROM customers');
    const added = await target.prepare("INSERT INTO customers (name, email) VALUES ('New', 'new@x.test')").run();
    expect(added.lastInsertRowid).toBe(before + 1);
    await expect(seedInto(target, 10, { viaCopy: true })).rejects.toThrow(/already has data/);
    await target.close();
  }, 120000);
});
