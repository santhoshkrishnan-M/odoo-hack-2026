export type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';
export const PERIODS: Period[] = ['daily', 'weekly', 'monthly', 'yearly'];

function parse(d: string): [number, number, number] {
  const [y, m, day] = d.split('-').map(Number);
  return [y, m - 1, day];
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** The date n periods after anchor. Months and years stay anchored to the anchor's day, clamped to month end. */
export function addPeriods(anchor: string, period: Period, n: number): string {
  const [y, m, d] = parse(anchor);
  if (period === 'daily' || period === 'weekly') {
    const days = period === 'daily' ? n : n * 7;
    return iso(new Date(Date.UTC(y, m, d + days)));
  }
  const months = period === 'monthly' ? n : n * 12;
  const total = m + months;
  const ty = y + Math.floor(total / 12);
  const tm = ((total % 12) + 12) % 12;
  return iso(new Date(Date.UTC(ty, tm, Math.min(d, daysInMonth(ty, tm)))));
}

/** How many of this period fit in a month, for monthly recurring revenue. */
export function monthlyFactor(period: Period): number {
  return { daily: 365 / 12, weekly: 52 / 12, monthly: 1, yearly: 1 / 12 }[period];
}

export function addDays(date: string, days: number): string {
  return addPeriods(date, 'daily', days);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}

const APPROX_DAYS: Record<Period, number> = { daily: 1, weekly: 7, monthly: 30.44, yearly: 365.25 };

/** The first period start (anchor + k periods, k ≥ 0) that is on or after `date`. */
export function nextPeriodStart(anchor: string, period: Period, date: string): string {
  if (date <= anchor) return anchor;
  let k = Math.max(0, Math.floor(daysBetween(anchor, date) / APPROX_DAYS[period]) - 1);
  while (addPeriods(anchor, period, k) < date) k += 1;
  return addPeriods(anchor, period, k);
}
