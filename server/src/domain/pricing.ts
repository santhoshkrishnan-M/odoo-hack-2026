export interface PriceLine {
  productId: number | null;
  description: string;
  quantity: number;
  unitPrice: number; // paise
  taxRate: number; // percent, e.g. 18
}

export interface DiscountRule {
  id: number;
  type: 'fixed' | 'percent';
  value: number; // paise when fixed, percent when percent
  minAmount: number; // paise
  minQuantity: number;
  startDate: string | null;
  endDate: string | null;
  usageLimit: number | null;
  usedCount: number;
  scope: 'products' | 'subscriptions';
  productIds: number[];
  subscriptionIds: number[]; // empty = every subscription
}

export interface PricedLine extends PriceLine {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

export interface PricedInvoice {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  appliedRuleIds: number[];
}

/** Split amount across weights so the parts sum exactly to amount (largest remainder). */
function spread(amount: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || amount <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / sum);
  const parts = raw.map(Math.floor);
  let left = amount - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

function isActiveOn(rule: DiscountRule, date: string, subscriptionId: number): boolean {
  if (rule.startDate && date < rule.startDate) return false;
  if (rule.endDate && date > rule.endDate) return false;
  if (rule.usageLimit !== null && rule.usedCount >= rule.usageLimit) return false;
  if (rule.scope === 'subscriptions' && rule.subscriptionIds.length > 0 && !rule.subscriptionIds.includes(subscriptionId)) return false;
  return true;
}

export function priceInvoice(lines: PriceLine[], rules: DiscountRule[], ctx: { date: string; subscriptionId: number }): PricedInvoice {
  const subtotals = lines.map((l) => Math.round(l.quantity * l.unitPrice));
  const discounts = lines.map(() => 0);
  const applied: number[] = [];

  for (const rule of [...rules].sort((a, b) => a.id - b.id)) {
    if (!isActiveOn(rule, ctx.date, ctx.subscriptionId)) continue;
    const idx = lines
      .map((l, i) => i)
      .filter((i) => rule.scope === 'subscriptions' || (lines[i].productId !== null && rule.productIds.includes(lines[i].productId!)));
    if (idx.length === 0) continue;
    const base = idx.reduce((a, i) => a + subtotals[i], 0);
    const qty = idx.reduce((a, i) => a + lines[i].quantity, 0);
    if (base < rule.minAmount || qty < rule.minQuantity) continue;

    const remaining = idx.map((i) => subtotals[i] - discounts[i]);
    let parts: number[];
    if (rule.type === 'percent') {
      parts = remaining.map((r) => Math.min(r, Math.round((r * rule.value) / 100)));
    } else if (rule.scope === 'products') {
      parts = remaining.map((r) => Math.min(r, rule.value));
    } else {
      const total = remaining.reduce((a, b) => a + b, 0);
      parts = spread(Math.min(rule.value, total), remaining);
    }
    if (parts.every((p) => p === 0)) continue;
    idx.forEach((i, k) => (discounts[i] += parts[k]));
    applied.push(rule.id);
  }

  const priced = lines.map((l, i) => {
    const net = subtotals[i] - discounts[i];
    const tax = Math.round((net * l.taxRate) / 100);
    return { ...l, subtotal: subtotals[i], discount: discounts[i], tax, total: net + tax };
  });
  const sum = (k: 'subtotal' | 'discount' | 'tax' | 'total') => priced.reduce((a, l) => a + l[k], 0);
  return { lines: priced, subtotal: sum('subtotal'), discountTotal: sum('discount'), taxTotal: sum('tax'), total: sum('total'), appliedRuleIds: applied };
}
