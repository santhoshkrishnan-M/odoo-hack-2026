const money2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('en-IN');

/** Integer paise as rupees with two decimals: 123450 → "₹1,234.50". */
export function money(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  return `${paise < 0 ? '−' : ''}₹${money2.format(Math.abs(paise) / 100)}`;
}
/** Whole rupees for headline figures: 2726716808 → "₹2,72,67,168". */
export function rupees(paise: number): string {
  return `${paise < 0 ? '−' : ''}₹${money0.format(Math.abs(paise) / 100)}`;
}
export const count = (n: number) => int.format(n);
export const toPaise = (rupeesText: string) => Math.round(Number.parseFloat(rupeesText || '0') * 100);
export const toRupeesText = (paise: number) => (paise / 100).toFixed(2);

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
}
const longDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const dateWords = (iso: string | null | undefined) => (iso ? longDate.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—');
const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'UTC' });
export const monthLabel = (ym: string) => monthShort.format(new Date(`${ym}-01T00:00:00Z`));

export const PERIOD_WORD: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
export const PERIOD_ADJ: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
export const METHOD_LABEL: Record<string, string> = { bank_transfer: 'Bank transfer', card: 'Card', upi: 'UPI', cash: 'Cash', cheque: 'Cheque' };
export const TERMS_LABEL: Record<number, string> = { 0: 'Due on receipt', 15: '15 days', 30: '30 days', 45: '45 days' };

export const SUB_STATUS: Record<string, { label: string; tone: '' | 'pos' | 'neg' | 'warn' }> = {
  draft: { label: 'Draft', tone: '' },
  quotation: { label: 'Quotation', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: '' },
  active: { label: 'Active', tone: 'pos' },
  paused: { label: 'Paused', tone: '' },
  closed: { label: 'Closed', tone: '' },
};
export const INV_STATUS: Record<string, { label: string; tone: '' | 'pos' | 'neg' | 'warn' }> = {
  draft: { label: 'Draft', tone: '' },
  confirmed: { label: 'Awaiting payment', tone: 'warn' },
  paid: { label: 'Paid', tone: 'pos' },
  cancelled: { label: 'Cancelled', tone: '' },
};

/** Invoice periods are stored with an exclusive end; people read the last day covered. */
export const periodText = (start: string, endExclusive: string) => `${start} to ${addDaysIso(endExclusive, -1)}`;
export const periodWords = (start: string, endExclusive: string) => {
  const last = addDaysIso(endExclusive, -1);
  return last === start ? dateWords(start) : `${dateWords(start)} to ${dateWords(last)}`;
};
