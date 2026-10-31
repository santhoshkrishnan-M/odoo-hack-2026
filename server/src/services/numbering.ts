import type { DB } from '../db/connection';

export type NumberKind = 'SUB' | 'INV' | 'CN';

/** Gap-free yearly sequence (SUB/2026/00001). The upsert is atomic, so concurrent callers never share a number. */
export async function nextNumber(db: DB, kind: NumberKind, year: number): Promise<string> {
  const row = await db.prepare(`INSERT INTO counters (kind, year, value) VALUES (?, ?, 1)
              ON CONFLICT (kind, year) DO UPDATE SET value = counters.value + 1 RETURNING value`).get<{ value: number }>(kind, year);
  return `${kind}/${year}/${String(row!.value).padStart(5, '0')}`;
}
