/** snake_case row -> camelCase object; 0/1 for listed boolean columns become booleans. */
const BOOLS = new Set(['active', 'auto_close', 'closable', 'pausable', 'renewable', 'published', 'churn']);

export function camel<T = Record<string, unknown>>(row: Record<string, unknown> | undefined): T {
  if (!row) return row as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = BOOLS.has(k) ? Boolean(v) : v;
  }
  return out as T;
}

export const camelAll = <T = Record<string, unknown>>(rows: unknown[]): T[] => rows.map((r) => camel<T>(r as Record<string, unknown>));
