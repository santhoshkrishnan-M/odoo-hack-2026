const fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Format integer paise as rupees, e.g. 123450 -> "₹1,234.50". */
export function formatMoney(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  return `${sign}₹${fmt.format(Math.abs(paise) / 100)}`;
}
