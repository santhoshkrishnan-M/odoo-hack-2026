import type { Request, Response } from 'express';
import type { DB } from './db/connection';
import type { SessionUser } from './services/auth';

/**
 * Live updates over Server-Sent Events.
 *
 * Every change writes a row to `activity`. Each server instance runs one poller that reads new rows every
 * couple of seconds and fans them out to the browsers connected to that instance, so it works the same on one
 * long-running server and on many serverless instances (no shared memory or broker needed). Browsers reconnect
 * automatically with Last-Event-ID and receive anything they missed.
 */
export interface LiveEvent { id: number; createdAt: string; type: string; entity: string; entityId: number | null; customerId: number | null; actorName: string; message: string; data: Record<string, unknown> }

const POLL_MS = Number(process.env.LIVE_POLL_MS ?? 2000);
const STREAM_MS = Number(process.env.LIVE_STREAM_MS ?? 240_000); // below the platform's function time limit; clients reconnect
const HIDDEN_FROM_CUSTOMERS = new Set(['billing', 'catalog', 'user', 'settings']);

type Listener = (rows: LiveEvent[]) => void;
const listeners = new Set<Listener>();
let lastId = -1;
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;

const SELECT = `SELECT id, created_at AS "createdAt", type, entity, entity_id AS "entityId", customer_id AS "customerId", actor_name AS "actorName", message, data FROM activity`;

async function tick(db: DB) {
  if (polling) return;
  polling = true;
  try {
    if (lastId < 0) lastId = Number((await db.query<{ m: number }>('SELECT coalesce(max(id), 0) AS m FROM activity'))[0].m);
    const rows = await db.query<LiveEvent>(`${SELECT} WHERE id > ? ORDER BY id LIMIT 200`, [lastId]);
    if (rows.length) {
      lastId = Number(rows[rows.length - 1].id);
      for (const l of listeners) l(rows);
    }
  } catch (e) {
    console.error('[live] poll failed', (e as Error).message);
  } finally {
    polling = false;
  }
  timer = listeners.size ? setTimeout(() => void tick(db), POLL_MS) : null;
}

function subscribe(db: DB, l: Listener) {
  listeners.add(l);
  if (!timer) timer = setTimeout(() => void tick(db), 50);
  return () => { listeners.delete(l); };
}

export function visibleTo(user: SessionUser, e: LiveEvent): boolean {
  if (user.role !== 'customer') return true;
  return e.customerId === user.customerId && !HIDDEN_FROM_CUSTOMERS.has(e.entity);
}

function shape(user: SessionUser, e: LiveEvent) {
  if (user.role !== 'customer') return e;
  return { id: e.id, createdAt: e.createdAt, type: e.type, entity: e.entity, entityId: e.entityId, message: e.message, data: { status: e.data?.status } };
}

export async function liveStream(req: Request, res: Response) {
  const user = req.user!;
  const db = req.db;
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  const write = (s: string) => { try { res.write(s); } catch { /* client went away */ } };
  write('retry: 2000\n\n');
  write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), pollMs: POLL_MS })}\n\n`);

  const send = (rows: LiveEvent[]) => {
    for (const e of rows) if (visibleTo(user, e)) write(`id: ${e.id}\nevent: activity\ndata: ${JSON.stringify(shape(user, e))}\n\n`);
  };

  // Catch up from Last-Event-ID (sent automatically by EventSource on reconnect).
  const since = Number(req.get('Last-Event-ID') ?? req.query.since ?? 0);
  if (since > 0) {
    const missed = await db.query<LiveEvent>(`${SELECT} WHERE id > ? ${user.role === 'customer' ? 'AND customer_id = ?' : ''} ORDER BY id LIMIT 200`,
      user.role === 'customer' ? [since, user.customerId] : [since]);
    send(missed);
  }

  const unsubscribe = subscribe(db, send);
  const heartbeat = setInterval(() => write(`: ping ${Date.now()}\n\n`), 15_000);
  const end = setTimeout(() => { write('event: reconnect\ndata: {}\n\n'); res.end(); }, STREAM_MS);
  req.on('close', () => { unsubscribe(); clearInterval(heartbeat); clearTimeout(end); });
}

/** Recent activity for the feed on the overview and in the portal. */
export async function recentActivity(db: DB, user: SessionUser, limit = 30) {
  const rows = user.role === 'customer'
    ? await db.query<LiveEvent>(`${SELECT} WHERE customer_id = ? AND entity NOT IN ('billing','catalog','user','settings') ORDER BY id DESC LIMIT ?`, [user.customerId, limit])
    : await db.query<LiveEvent>(`${SELECT} ORDER BY id DESC LIMIT ?`, [limit]);
  return rows.map((r) => shape(user, r));
}
