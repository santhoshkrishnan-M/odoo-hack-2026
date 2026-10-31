import type { DB } from '../db/connection';

export interface CompanySettings { name: string; legalName: string; address: string; gstin: string; email: string; phone: string; invoiceFooter: string }
export interface BillingSettings {
  /** Confirm invoices as soon as the daily run creates them. */
  autoConfirm: boolean;
  /** Email confirmed invoices to the customer automatically. */
  autoSend: boolean;
  /** Days after the due date on which a payment reminder goes out. */
  reminderDays: number[];
  /** Close a subscription when an invoice is this many days overdue (0 = never). */
  dunningCloseDays: number;
  /** Days before the end date on which a renewal reminder goes out (0 = never). */
  renewalReminderDays: number;
  /** Customers can pay invoices online from the portal. */
  onlinePayments: boolean;
}
export interface Settings { company: CompanySettings; billing: BillingSettings }

export const DEFAULT_SETTINGS: Settings = {
  company: {
    name: 'Brightloop Software', legalName: 'Brightloop Software Pvt Ltd', address: '2nd Floor, 48 Race Course Road, Coimbatore, Tamil Nadu 641018',
    gstin: '33AABCB1234F1Z5', email: 'billing@brightloop.test', phone: '+91 422 400 1234',
    invoiceFooter: 'Thank you for your business. Bank: HDFC Bank, A/c 50200012345678, IFSC HDFC0001234.',
  },
  billing: { autoConfirm: true, autoSend: true, reminderDays: [1, 7, 14], dunningCloseDays: 0, renewalReminderDays: 7, onlinePayments: true },
};

export async function getSettings(db: DB): Promise<Settings> {
  const rows = await db.query<{ key: string; value: unknown }>('SELECT key, value FROM settings');
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    if (r.key === 'company') out.company = { ...out.company, ...(r.value as Partial<CompanySettings>) };
    if (r.key === 'billing') out.billing = { ...out.billing, ...(r.value as Partial<BillingSettings>) };
  }
  return out;
}

export async function saveSettings(db: DB, key: keyof Settings, value: unknown) {
  await db.query('INSERT INTO settings (key, value) VALUES (?, ?::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)]);
}
