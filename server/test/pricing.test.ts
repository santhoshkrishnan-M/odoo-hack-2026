import { describe, it, expect } from 'vitest';
import { nextStatus } from '../src/domain/lifecycle';
import { priceInvoice, type DiscountRule, type PriceLine } from '../src/domain/pricing';

const ctx = { date: '2026-10-31', subscriptionId: 1 };
const line = (o: Partial<PriceLine> = {}): PriceLine => ({ productId: 7, description: 'CRM', quantity: 2, unitPrice: 100000, taxRate: 18, ...o });
const rule = (o: Partial<DiscountRule> = {}): DiscountRule => ({
  id: 1, type: 'percent', value: 10, minAmount: 0, minQuantity: 0, startDate: null, endDate: null,
  usageLimit: null, usedCount: 0, scope: 'subscriptions', productIds: [], subscriptionIds: [], ...o,
});

describe('nextStatus', () => {
  it('follows the documented path', async () => {
    expect(nextStatus('draft', 'send')).toBe('quotation');
    expect(nextStatus('quotation', 'confirm')).toBe('confirmed');
    expect(nextStatus('confirmed', 'activate')).toBe('active');
    expect(nextStatus('active', 'pause')).toBe('paused');
    expect(nextStatus('paused', 'resume')).toBe('active');
    expect(nextStatus('active', 'close')).toBe('closed');
  });
  it('rejects moves outside the graph', async () => {
    expect(nextStatus('closed', 'resume')).toBeNull();
    expect(nextStatus('draft', 'activate')).toBeNull();
    expect(nextStatus('closed', 'close')).toBeNull();
  });
});

describe('priceInvoice', () => {
  it('adds tax on top of the line', async () => {
    const r = priceInvoice([line()], [], ctx);
    expect(r).toMatchObject({ subtotal: 200000, discountTotal: 0, taxTotal: 36000, total: 236000, appliedRuleIds: [] });
  });
  it('applies a subscription-wide percentage before tax', async () => {
    const r = priceInvoice([line()], [rule()], ctx);
    expect(r).toMatchObject({ discountTotal: 20000, taxTotal: 32400, total: 212400, appliedRuleIds: [1] });
  });
  it('applies a product-scoped fixed discount only to matching lines', async () => {
    const r = priceInvoice([line(), line({ productId: 8 })], [rule({ type: 'fixed', value: 50000, scope: 'products', productIds: [7] })], ctx);
    expect(r.lines[0].discount).toBe(50000);
    expect(r.lines[1].discount).toBe(0);
  });
  it('skips a rule whose minimum quantity is not met', async () => {
    expect(priceInvoice([line()], [rule({ minQuantity: 5 })], ctx).appliedRuleIds).toEqual([]);
  });
  it('skips a rule whose minimum purchase is not met', async () => {
    expect(priceInvoice([line()], [rule({ minAmount: 300000 })], ctx).appliedRuleIds).toEqual([]);
  });
  it('skips an expired or not-yet-started rule', async () => {
    expect(priceInvoice([line()], [rule({ endDate: '2026-10-30' })], ctx).appliedRuleIds).toEqual([]);
    expect(priceInvoice([line()], [rule({ startDate: '2026-11-01' })], ctx).appliedRuleIds).toEqual([]);
  });
  it('skips a used-up rule', async () => {
    expect(priceInvoice([line()], [rule({ usageLimit: 3, usedCount: 3 })], ctx).appliedRuleIds).toEqual([]);
  });
  it('skips a rule limited to other subscriptions', async () => {
    expect(priceInvoice([line()], [rule({ subscriptionIds: [99] })], ctx).appliedRuleIds).toEqual([]);
  });
  it('never makes the invoice negative', async () => {
    const r = priceInvoice([line()], [rule({ type: 'fixed', value: 1000000 })], ctx);
    expect(r.discountTotal).toBe(200000);
    expect(r.total).toBe(0);
  });
  it('spreads a fixed discount across lines so it sums exactly', async () => {
    const r = priceInvoice(
      [line({ quantity: 1, unitPrice: 1000 }), line({ productId: 8, quantity: 1, unitPrice: 2000 })],
      [rule({ type: 'fixed', value: 1000 })], ctx);
    expect(r.lines.map((l) => l.discount)).toEqual([333, 667]);
    expect(r.discountTotal).toBe(1000);
  });
});
