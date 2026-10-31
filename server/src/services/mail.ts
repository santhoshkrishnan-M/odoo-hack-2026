import type { DB } from '../db/connection';

/**
 * Every email is written to the outbox (the email log admins can read). When SMTP_URL is set it is also
 * delivered, e.g. SMTP_URL=smtps://user:pass@smtp.example.com:465 and MAIL_FROM="Brightloop <billing@example.com>".
 */
type Transport = { sendMail: (m: { from: string; to: string; subject: string; text: string }) => Promise<unknown> };
let transport: Transport | null | undefined;

async function getTransport(): Promise<Transport | null> {
  if (transport !== undefined) return transport;
  const url = process.env.SMTP_URL;
  if (!url) return (transport = null);
  const nodemailer = await import('nodemailer');
  transport = nodemailer.createTransport(url) as unknown as Transport;
  return transport;
}

export const mailDeliveryEnabled = () => Boolean(process.env.SMTP_URL);

export async function sendMail(db: DB, to: string, subject: string, body: string, kind = 'general'): Promise<void> {
  const r = await db.prepare('INSERT INTO outbox (to_email, subject, body, kind) VALUES (?, ?, ?, ?)').run(to, subject, body, kind);
  const quiet = process.env.NODE_ENV === 'test' || process.env.VITEST;
  const t = await getTransport();
  if (!t) {
    if (!quiet) console.log(`[mail] logged for ${to}: ${subject}`);
    return;
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM ?? 'Brightloop Billing <no-reply@brightloop.test>', to, subject, text: body });
    await db.query("UPDATE outbox SET status = 'sent' WHERE id = ?", [r.lastInsertRowid]);
  } catch (e) {
    console.error('[mail] delivery failed', (e as Error).message);
    await db.query("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", [String((e as Error).message).slice(0, 500), r.lastInsertRowid]);
  }
}
