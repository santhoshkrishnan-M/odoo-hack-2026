import { describe, it, expect } from 'vitest';
import { validatePassword, normalizeEmail } from '../src/domain/password';
import { formatMoney } from '../src/domain/money';
import { addPeriods, monthlyFactor } from '../src/domain/periods';

describe('validatePassword', () => {
  it('rejects 8 characters as too short', async () => {
    expect(validatePassword('Short!1a')).toEqual(['Use more than eight characters.']);
  });
  it('requires an uppercase letter', async () => {
    expect(validatePassword('alllowercase!')).toEqual(['Add an uppercase letter.']);
  });
  it('requires a lowercase letter', async () => {
    expect(validatePassword('ALLUPPER!!X')).toEqual(['Add a lowercase letter.']);
  });
  it('requires a special character', async () => {
    expect(validatePassword('NoSpecial123')).toEqual(['Add a special character, such as ! or #.']);
  });
  it('accepts a valid password', async () => {
    expect(validatePassword('Valid!pass')).toEqual([]);
  });
});

describe('normalizeEmail', () => {
  it('trims and lower-cases', async () => {
    expect(normalizeEmail('  Ann@X.COM ')).toBe('ann@x.com');
  });
});

describe('formatMoney', () => {
  it('formats paise as rupees with grouping', async () => {
    expect(formatMoney(123450)).toBe('₹1,234.50');
    expect(formatMoney(0)).toBe('₹0.00');
    expect(formatMoney(12345678900)).toBe('₹12,34,56,789.00');
  });
});

describe('addPeriods', () => {
  it('clamps a month-end start to a shorter month', async () => {
    expect(addPeriods('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
  });
  it('returns to the anchor day after a short month (no drift)', async () => {
    expect(addPeriods('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
  });
  it('clamps a leap day on yearly', async () => {
    expect(addPeriods('2028-02-29', 'yearly', 1)).toBe('2029-02-28');
  });
  it('adds weeks and days across month ends', async () => {
    expect(addPeriods('2026-10-31', 'weekly', 1)).toBe('2026-11-07');
    expect(addPeriods('2026-10-31', 'daily', 1)).toBe('2026-11-01');
  });
  it('handles zero', async () => {
    expect(addPeriods('2026-05-15', 'monthly', 0)).toBe('2026-05-15');
  });
});

describe('monthlyFactor', () => {
  it('normalizes each period to a month', async () => {
    expect(monthlyFactor('monthly')).toBe(1);
    expect(monthlyFactor('yearly')).toBeCloseTo(1 / 12);
    expect(monthlyFactor('weekly')).toBeCloseTo(52 / 12);
    expect(monthlyFactor('daily')).toBeCloseTo(365 / 12);
  });
});

import { nextPeriodStart } from '../src/domain/periods';
describe('nextPeriodStart', () => {
  it('finds the first period start on or after a date', async () => {
    expect(nextPeriodStart('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(nextPeriodStart('2026-01-31', 'monthly', '2026-03-31')).toBe('2026-03-31');
    expect(nextPeriodStart('2026-01-01', 'weekly', '2026-01-09')).toBe('2026-01-15');
    expect(nextPeriodStart('2026-05-01', 'yearly', '2026-04-01')).toBe('2026-05-01');
  });
});
