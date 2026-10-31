import type { DB } from '../db/connection';
import { addDays, today } from '../domain/periods';
import { formatMoney } from '../domain/money';
import { runBillingDetailed } from './billing';
import { confirmInvoice, remindInvoice, sendInvoice } from './invoices';
import { applySubscriptionAction } from './subscriptions';
import { getSettings } from './settings';
import { logActivity, SYSTEM, type Actor } from './activity';
import { sendMail } from './mail';

export interface DailyResult {
  asOf: string; created: number; closed: number; confirmed: number; sent: number; reminders: number; dunningClosed: number;
  renewalReminders: number; quotationsExpired: number; sessionsPurged: number; ms: number;
}

/**
 * The daily automation, run by the scheduler (Vercel Cron in production, an in-process timer locally) and on demand by staff:
 *  1. bill every due period and close subscriptions that reached their end date;
 *  2. confirm and email the new invoices (per settings);
 *  3. send payment reminders on the configured days after the due date;
 *  4. dunning: close subscriptions whose invoices are overdue past the limit (when enabled);
 *  5. renewal reminders before end dates; 6. expire stale quotations; 7. housekeeping.
 * Every step is idempotent, so running it twice on the same day changes nothing the second time.
 */
export async function runDaily(db: DB, opts: { asOf?: string; appUrl: string; trigger: 'cron' | 'manual' | 'timer'; actor?: Actor }): Promise<DailyResult> {
  const started = performance.now();
  const asOf = opts.asOf ?? today();
  const actor = opts.actor ?? SYSTEM;
  const run = await db.prepare("INSERT INTO job_runs (job, triggered_by) VALUES ('daily', ?)").run(opts.trigger);
  const { billing } = await getSettings(db);
  const out: DailyResult = { asOf, created: 0, closed: 0, confirmed: 0, sent: 0, reminders: 0, dunningClosed: 0, renewalReminders: 0, quotationsExpired: 0, sessionsPurged: 0, ms: 0 };
  try {
    const b = await runBillingDetailed(db, asOf, actor);
    out.created = b.created;
    out.closed = b.closed;

    if (billing.autoConfirm) {
      const drafts = await db.query<{ id: number }>("SELECT id FROM invoices WHERE status = 'draft' AND kind = 'recurring' AND invoice_date <= ? ORDER BY id", [asOf]);
      for (const d of drafts) { await confirmInvoice(db, d.id, actor); out.confirmed += 1; }
    }
    if (billing.autoSend) {
      const unsent = await db.query<{ id: number }>(`SELECT id FROM invoices WHERE status IN ('confirmed','paid') AND sent_at IS NULL AND kind <> 'credit_note'
        AND invoice_date <= ? ORDER BY id LIMIT 500`, [asOf]);
      for (const u of unsent) { await sendInvoice(db, u.id, opts.appUrl, actor); out.sent += 1; }
    }

    // Reminders: on each configured day after the due date, at most once per day per invoice.
    const days = [...new Set(billing.reminderDays.filter((d) => d > 0))].sort((a, b) => a - b);
    if (days.length) {
      const overdue = await db.query<{ id: number; late: number; reminder_count: number }>(`SELECT id, (?::date - due_date) AS late, reminder_count FROM invoices
        WHERE status = 'confirmed' AND kind <> 'credit_note' AND due_date < ? AND (last_reminder_at IS NULL OR last_reminder_at::date < ?::date)
        ORDER BY due_date LIMIT 500`, [asOf, asOf, asOf]);
      for (const inv of overdue) {
        const owedReminders = days.filter((d) => inv.late >= d).length;
        if (owedReminders > inv.reminder_count) { await remindInvoice(db, inv.id, opts.appUrl, actor); out.reminders += 1; }
      }
    }

    if (billing.dunningCloseDays > 0) {
      const reason = await db.prepare("SELECT id FROM close_reasons WHERE name = 'Unpaid invoices'").get<{ id: number }>();
      const subs = await db.query<{ id: number; number: string; owed: number }>(`SELECT s.id, s.number, sum(i.total - i.amount_paid) AS owed FROM subscriptions s
        JOIN invoices i ON i.subscription_id = s.id AND i.status = 'confirmed' AND i.kind <> 'credit_note' AND i.due_date <= ?::date - ?::int
        WHERE s.status IN ('active','paused') GROUP BY s.id`, [asOf, billing.dunningCloseDays]);
      for (const s of subs) {
        await applySubscriptionAction(db, s.id, 'close', actor, { reasonId: reason?.id ?? null, note: `Closed automatically: ${formatMoney(s.owed)} unpaid for over ${billing.dunningCloseDays} days` })
          .then(() => { out.dunningClosed += 1; })
          .catch(() => undefined); // plans that forbid early close stay open
      }
    }

    if (billing.renewalReminderDays > 0) {
      const ending = await db.query<{ id: number; number: string; expiry_date: string; name: string; email: string; customer_id: number }>(`SELECT s.id, s.number, s.expiry_date, c.name, c.email, c.id AS customer_id
        FROM subscriptions s JOIN customers c ON c.id = s.customer_id JOIN plans p ON p.id = s.plan_id
        WHERE s.status = 'active' AND p.renewable = 1 AND s.expiry_date = ?::date + ?::int`, [asOf, billing.renewalReminderDays]);
      for (const s of ending) {
        const already = await db.prepare("SELECT 1 FROM activity WHERE entity = 'subscription' AND entity_id = ? AND type = 'subscription.renewal_reminder' AND created_at::date = ?::date").get(s.id, asOf);
        if (already) continue;
        await sendMail(db, s.email, `${s.number} ends on ${s.expiry_date}`,
          `Hello ${s.name},\n\nYour subscription ${s.number} ends on ${s.expiry_date}. Renew it from your portal to keep using it without a break:\n${opts.appUrl}/portal/subscriptions/${s.id}\n`, 'renewal');
        await logActivity(db, { type: 'subscription.renewal_reminder', entity: 'subscription', entityId: s.id, customerId: s.customer_id, actor, message: `Renewal reminder sent for ${s.number} (ends ${s.expiry_date}).` });
        out.renewalReminders += 1;
      }
    }

    const stale = await db.query<{ id: number }>("SELECT id FROM subscriptions WHERE status = 'quotation' AND valid_until < ?::date - 30", [asOf]);
    for (const q of stale) {
      const reason = await db.prepare("SELECT id FROM close_reasons WHERE name = 'Quotation expired'").get<{ id: number }>();
      await applySubscriptionAction(db, q.id, 'close', actor, { reasonId: reason?.id ?? null, note: 'Quotation expired over 30 days ago' });
      out.quotationsExpired += 1;
    }

    out.sessionsPurged = (await db.prepare('DELETE FROM sessions WHERE expires_at < now()').run()).changes;
    await db.query("DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'");
    await db.query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
    await db.query("UPDATE checkouts SET status = 'expired' WHERE status = 'pending' AND created_at < now() - interval '1 day'");
    await db.query("DELETE FROM activity WHERE created_at < now() - interval '400 days'");

    out.ms = Math.round(performance.now() - started);
    await db.query('UPDATE job_runs SET finished_at = now(), ok = 1, summary = ?::jsonb WHERE id = ?', [JSON.stringify(out), run.lastInsertRowid]);
    await logActivity(db, { type: 'automation.daily', entity: 'billing', actor,
      message: `Daily automation for ${asOf}: ${out.created} invoices created, ${out.confirmed} confirmed, ${out.sent} sent, ${out.reminders} reminders, ${out.closed + out.dunningClosed} subscriptions closed.`,
      data: { ...out } });
    return out;
  } catch (e) {
    await db.query('UPDATE job_runs SET finished_at = now(), ok = 0, summary = ?::jsonb WHERE id = ?', [JSON.stringify({ ...out, error: (e as Error).message }), run.lastInsertRowid]);
    throw e;
  }
}

export async function lastRuns(db: DB, limit = 10) {
  return db.query(`SELECT id, job, triggered_by AS "trigger", started_at AS "startedAt", finished_at AS "finishedAt", ok, summary FROM job_runs ORDER BY id DESC LIMIT ?`, [limit]);
}

export { addDays };
