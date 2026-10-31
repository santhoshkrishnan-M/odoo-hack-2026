import type { DB } from '../db/connection';
import { monthlyFactor, type Period } from '../domain/periods';

export interface Actor { id: number | null; name: string }
export const SYSTEM: Actor = { id: null, name: 'System' };

export type Entity = 'subscription' | 'invoice' | 'payment' | 'customer' | 'billing' | 'catalog' | 'user' | 'settings';

/**
 * Writes one entry to the activity log. The log is the audit trail shown on every record ("chatter")
 * and also the feed the live event stream sends to open browsers.
 */
export async function logActivity(db: DB, e: {
  type: string; entity: Entity; entityId?: number | null; customerId?: number | null; actor?: Actor; message: string; data?: Record<string, unknown>;
}): Promise<void> {
  const a = e.actor ?? SYSTEM;
  await db.query(`INSERT INTO activity (type, entity, entity_id, customer_id, actor_id, actor_name, message, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb)`,
    [e.type, e.entity, e.entityId ?? null, e.customerId ?? null, a.id, a.name, e.message, JSON.stringify(e.data ?? {})]);
}

export async function activityFor(db: DB, entity: Entity, entityId: number, limit = 50) {
  return db.query(`SELECT id, created_at AS "createdAt", type, actor_name AS "actorName", message, data FROM activity
    WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT ?`, [entity, entityId, limit]);
}

/** Monthly recurring revenue of one subscription in paise (plan fee + lines, before tax and discounts). */
export async function subscriptionMrr(db: DB, subscriptionId: number): Promise<number> {
  const r = await db.prepare(`SELECT p.price, p.period, coalesce((SELECT sum(quantity * unit_price) FROM subscription_lines WHERE subscription_id = s.id), 0) AS lines
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.id = ?`).get<{ price: number; period: Period; lines: number }>(subscriptionId);
  if (!r) return 0;
  return Math.round((r.price + r.lines) * monthlyFactor(r.period));
}

export type MrrKind = 'new' | 'expansion' | 'contraction' | 'churn' | 'reactivation';
export async function recordMrr(db: DB, subscriptionId: number, kind: MrrKind, delta: number, date: string) {
  await db.query('INSERT INTO mrr_events (subscription_id, date, kind, delta) VALUES (?, ?, ?, ?)', [subscriptionId, date, kind, Math.round(delta)]);
}
