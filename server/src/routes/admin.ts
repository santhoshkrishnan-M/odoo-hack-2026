import { Router } from 'express';
import { z } from 'zod';
import { validate, pageOf, PAGE_SIZE } from '../http';
import { requireRole, requireAuth, actor, me } from '../middleware/auth';
import { getSettings, saveSettings } from '../services/settings';
import { logActivity } from '../services/activity';
import { mailDeliveryEnabled } from '../services/mail';
import { razorpayEnabled } from '../services/payments';
import { recentActivity } from '../realtime';

const router = Router();

/** Activity feed: everything for staff, own records for customers. */
router.get('/activity', requireAuth, async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30) || 30));
  res.json({ rows: await recentActivity(req.db, me(req), limit) });
});

router.get('/close-reasons', requireRole('admin', 'staff'), async (req, res) => {
  res.json({ rows: await req.db.query('SELECT id, name, churn, active FROM close_reasons ORDER BY id') });
});

router.get('/settings', requireRole('admin', 'staff'), async (req, res) => {
  res.json({ ...(await getSettings(req.db)), integrations: { email: mailDeliveryEnabled() ? 'smtp' : 'log', payments: razorpayEnabled() ? 'razorpay' : 'sandbox',
    cron: Boolean(process.env.CRON_SECRET), database: req.db.engine } });
});

const company = z.object({
  name: z.string().trim().min(1).max(120), legalName: z.string().trim().max(200), address: z.string().trim().max(500),
  gstin: z.string().trim().toUpperCase().max(15).regex(/^$|^[0-9]{2}[A-Z0-9]{13}$/, 'A GSTIN has 15 characters, starting with the state code.'),
  email: z.string().trim().email('Enter a valid email address.'), phone: z.string().trim().max(40), invoiceFooter: z.string().max(1000),
});
const billing = z.object({
  autoConfirm: z.boolean(), autoSend: z.boolean(), onlinePayments: z.boolean(),
  reminderDays: z.array(z.number().int().min(1).max(365)).max(10),
  dunningCloseDays: z.number().int().min(0).max(365),
  renewalReminderDays: z.number().int().min(0).max(90),
});

router.put('/settings', requireRole('admin'), async (req, res) => {
  const b = validate(z.object({ company: company.optional(), billing: billing.optional() }), req.body);
  if (b.company) await saveSettings(req.db, 'company', b.company);
  if (b.billing) await saveSettings(req.db, 'billing', { ...b.billing, reminderDays: [...new Set(b.billing.reminderDays)].sort((x, y) => x - y) });
  await logActivity(req.db, { type: 'settings.updated', entity: 'settings', actor: actor(req), message: `Settings updated (${[b.company ? 'company' : '', b.billing ? 'billing automation' : ''].filter(Boolean).join(', ')}).` });
  res.json(await getSettings(req.db));
});

/** Email log: every message the app sent or would have sent. Admin only (it can contain reset links). */
router.get('/emails', requireRole('admin'), async (req, res) => {
  const { page, limit, offset } = pageOf(req.query);
  const q = String(req.query.q ?? '').trim();
  const w = q ? 'WHERE to_email ILIKE ? OR subject ILIKE ?' : '';
  const args = q ? [`%${q}%`, `%${q}%`] : [];
  const total = (await req.db.prepare(`SELECT count(*) AS n FROM outbox ${w}`).get<{ n: number }>(...args))!.n;
  const rows = await req.db.query(`SELECT id, to_email AS "toEmail", subject, body, kind, status, error, created_at AS "createdAt" FROM outbox ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  res.json({ rows, total, page, pageSize: PAGE_SIZE, delivery: mailDeliveryEnabled() ? 'smtp' : 'log' });
});

export default router;
