import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * One EventSource per tab, connected while someone is signed in. Every change anywhere in the business arrives
 * here within a couple of seconds; screens refetch quietly and the toaster shows what matters.
 */
export interface LiveEvent { id: number; createdAt: string; type: string; entity: string; entityId: number | null; customerId?: number | null; actorName?: string; message: string; data: Record<string, unknown> }
export type LiveStatus = 'off' | 'connecting' | 'live' | 'reconnecting';

let source: EventSource | null = null;
let status: LiveStatus = 'off';
let version = 0;
let lastAt: string | null = null;
const statusListeners = new Set<() => void>();
const versionListeners = new Set<() => void>();
const eventListeners = new Set<(batch: LiveEvent[]) => void>();
let pending: LiveEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function setStatus(s: LiveStatus) {
  if (status === s) return;
  status = s;
  statusListeners.forEach((l) => l());
}

function flush() {
  flushTimer = null;
  const batch = pending;
  pending = [];
  if (!batch.length) return;
  lastAt = batch[batch.length - 1].createdAt;
  version += 1;
  versionListeners.forEach((l) => l());
  eventListeners.forEach((l) => l(batch));
}

export function startLive() {
  if (source || typeof EventSource === 'undefined') return;
  setStatus('connecting');
  const es = new EventSource('/api/live', { withCredentials: true });
  source = es;
  es.addEventListener('hello', () => setStatus('live'));
  es.addEventListener('activity', (m) => {
    try { pending.push(JSON.parse((m as MessageEvent).data)); } catch { return; }
    // Bursts (a billing run confirming hundreds of invoices) become one refresh.
    flushTimer ??= setTimeout(flush, 500);
  });
  es.addEventListener('reconnect', () => setStatus('reconnecting'));
  es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? 'off' : 'reconnecting');
  es.onopen = () => setStatus('live');
}

export function stopLive() {
  source?.close();
  source = null;
  setStatus('off');
}

export const useLiveStatus = () => useSyncExternalStore((cb) => { statusListeners.add(cb); return () => statusListeners.delete(cb); }, () => status);
export const useLiveVersion = () => useSyncExternalStore((cb) => { versionListeners.add(cb); return () => versionListeners.delete(cb); }, () => version);
export const lastEventAt = () => lastAt;

export function useLiveEvents(fn: (batch: LiveEvent[]) => void) {
  useEffect(() => {
    eventListeners.add(fn);
    return () => { eventListeners.delete(fn); };
  }, [fn]);
}

/** Re-renders every `ms` so relative times ("2 min ago") stay true. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}
