import pg from 'pg';
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { SCHEMA, SCHEMA_VERSION } from './schema';

/**
 * One async database interface for two engines:
 *  - PostgreSQL over the network (Neon in production) through node-postgres;
 *  - PGlite, an in-process PostgreSQL, for local development and tests (no server to install).
 *
 * SQL is written with `?` placeholders; they are numbered ($1, $2…) here. `prepare(sql).get/all/run`
 * mirrors the small statement API the services use. INSERTs into tables with an `id` column return it
 * as `lastInsertRowid` (RETURNING id is added automatically when the statement has no RETURNING clause).
 */
export interface RunResult { changes: number; lastInsertRowid: number; rows: Record<string, unknown>[] }
export interface Stmt {
  get<T = Record<string, unknown>>(...args: unknown[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(...args: unknown[]): Promise<T[]>;
  run(...args: unknown[]): Promise<RunResult>;
}
export interface DB {
  readonly engine: 'postgres' | 'pglite';
  readonly inTransaction: boolean;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  prepare(sql: string): Stmt;
  exec(sql: string): Promise<void>;
  /** Runs fn in a transaction; nested calls join the outer transaction. */
  tx<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const ID_TABLES = new Set(['customers', 'users', 'outbox', 'taxes', 'products', 'product_variants', 'plans', 'quotation_templates', 'template_lines',
  'subscriptions', 'subscription_lines', 'discounts', 'invoices', 'invoice_lines', 'payments', 'activity', 'close_reasons', 'mrr_events', 'job_runs']);

/** `?` → `$n`, skipping quoted strings. */
export function numbered(sql: string): string {
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) { out += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
    if (ch === '?') { out += `$${++n}`; continue; }
    out += ch;
  }
  return out;
}

function withReturning(sql: string): string {
  const m = /^\s*INSERT\s+INTO\s+([a-z_]+)/i.exec(sql);
  if (!m || !ID_TABLES.has(m[1].toLowerCase()) || /\bRETURNING\b/i.test(sql)) return sql;
  return `${sql.trimEnd().replace(/;$/, '')} RETURNING id`;
}

const toIso = (v: string) => new Date(v.includes('T') ? v : v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString();
const asNumber = (v: string) => (v === null ? null : Number(v));
const asText = (v: string) => v;

let pgTypesSet = false;
function setPgTypes() {
  if (pgTypesSet) return;
  pgTypesSet = true;
  pg.types.setTypeParser(20, asNumber); // int8 (count, sum)
  pg.types.setTypeParser(1700, asNumber); // numeric
  pg.types.setTypeParser(1082, asText); // date stays 'YYYY-MM-DD'
  pg.types.setTypeParser(1184, toIso); // timestamptz → ISO string
  pg.types.setTypeParser(1114, toIso);
}

const norm = (args: unknown[]) => args.map((a) => (a === undefined ? null : a));

type Runner = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[]; affectedRows: number }>;

function makeDb(engine: DB['engine'], run: Runner, extra: { exec: (sql: string) => Promise<void>; tx: DB['tx']; close: () => Promise<void>; inTransaction: boolean }): DB {
  const db: DB = {
    engine,
    inTransaction: extra.inTransaction,
    async query<T>(sql: string, params: unknown[] = []) {
      return (await run(numbered(sql), norm(params))).rows as T[];
    },
    prepare(sql: string): Stmt {
      return {
        async get<T>(...args: unknown[]) { return (await run(numbered(sql), norm(args))).rows[0] as T | undefined; },
        async all<T>(...args: unknown[]) { return (await run(numbered(sql), norm(args))).rows as T[]; },
        async run(...args: unknown[]) {
          const r = await run(numbered(withReturning(sql)), norm(args));
          const last = r.rows.length ? Number(r.rows[r.rows.length - 1].id ?? 0) : 0;
          return { changes: r.affectedRows, lastInsertRowid: last, rows: r.rows };
        },
      };
    },
    exec: extra.exec,
    tx: extra.tx,
    close: extra.close,
  };
  return db;
}

/* ---------- PostgreSQL (Neon) ---------- */
let sharedPool: pg.Pool | null = null;

export function openPostgres(connectionString: string): DB {
  setPgTypes();
  sharedPool ??= new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ssl: /sslmode=disable|localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: true },
  });
  const pool = sharedPool;
  pool.on('error', (e) => console.error('[db] idle client error', e.message));
  const clientDb = (client: pg.PoolClient): DB =>
    makeDb('postgres', async (sql, params) => { const r = await client.query(sql, params); return { rows: r.rows, affectedRows: r.rowCount ?? 0 }; }, {
      inTransaction: true,
      exec: async (sql) => { await client.query(sql); },
      tx: async (fn) => fn(clientDb(client)),
      close: async () => undefined,
    });
  return makeDb('postgres', async (sql, params) => { const r = await pool.query(sql, params); return { rows: r.rows, affectedRows: r.rowCount ?? 0 }; }, {
    inTransaction: false,
    exec: async (sql) => { await pool.query(sql); },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(clientDb(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    },
    close: async () => { await pool.end(); sharedPool = null; },
  });
}

/* ---------- PGlite (local / tests) ---------- */
const PGLITE_PARSERS = { 20: asNumber, 1700: asNumber, 1082: asText, 1184: toIso, 1114: toIso } as Record<number, (v: string) => unknown>;

export async function openPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite');
  const lite: PGlite = new PGlite({ dataDir, parsers: PGLITE_PARSERS });
  await lite.waitReady;
  const txDb = (t: Transaction): DB =>
    makeDb('pglite', async (sql, params) => { const r = await t.query<Record<string, unknown>>(sql, params); return { rows: r.rows, affectedRows: r.affectedRows ?? 0 }; }, {
      inTransaction: true,
      exec: async (sql) => { await t.exec(sql); },
      tx: async (fn) => fn(txDb(t)),
      close: async () => undefined,
    });
  return makeDb('pglite', async (sql, params) => { const r = await lite.query<Record<string, unknown>>(sql, params); return { rows: r.rows, affectedRows: r.affectedRows ?? 0 }; }, {
    inTransaction: false,
    exec: async (sql) => { await lite.exec(sql); },
    tx: async (fn) => lite.transaction(async (t) => fn(txDb(t))),
    close: async () => { await lite.close(); },
  });
}

/** Creates or upgrades the schema. Safe to call on every cold start: it is a no-op once the version matches. */
export async function migrate(db: DB): Promise<void> {
  const has = await db.query<{ ok: boolean }>("SELECT to_regclass('public.schema_meta') IS NOT NULL AS ok");
  if (has[0]?.ok) {
    const v = await db.query<{ version: number }>('SELECT version FROM schema_meta LIMIT 1');
    if (v[0]?.version === SCHEMA_VERSION) return;
  }
  await db.tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock(72021)');
    await t.exec(SCHEMA);
    await t.query('DELETE FROM schema_meta');
    await t.query('INSERT INTO schema_meta (version) VALUES (?)', [SCHEMA_VERSION]);
  });
}

/** Opens the database the environment points at: DATABASE_URL (Postgres) or an embedded PGlite (memory or PGLITE_DIR). */
export async function openFromEnv(): Promise<DB> {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const db = url ? openPostgres(url) : await openPglite(process.env.PGLITE_DIR);
  await migrate(db);
  return db;
}

/**
 * A clean database for one test. Starting PGlite takes a couple of seconds, so each test process keeps one
 * instance and wipes the schema between tests (about 80 ms).
 */
let testInstance: Promise<DB> | null = null;
export async function openTestDb(): Promise<DB> {
  testInstance ??= openPglite();
  const db = await testInstance;
  await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  return db;
}
