import { Router, type Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http';
import { requireAuth, appUrl } from '../middleware/auth';
import { liveStream } from '../realtime';
import { runDaily } from '../services/jobs';
import { handleRazorpayWebhook } from '../services/payments';

const router = Router();

router.get('/health', async (req, res) => {
  const t = performance.now();
  await req.db.query('SELECT 1');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, database: req.db.engine, dbMs: Math.round(performance.now() - t), time: new Date().toISOString() });
});

router.get('/live', requireAuth, liveStream);

const bearerOk = (req: Request, secret: string | undefined) => {
  if (!secret) return false;
  const got = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret));
};

/** Vercel Cron calls this once a day with `Authorization: Bearer $CRON_SECRET`. */
router.get('/cron/daily', async (req, res) => {
  if (!bearerOk(req, process.env.CRON_SECRET)) throw new HttpError(401, 'Not allowed.');
  res.json(await runDaily(req.db, { appUrl: appUrl(req), trigger: 'cron' }));
});

/** Razorpay webhook — needs the exact raw body for the signature check. */
router.post('/webhooks/razorpay', async (req, res) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
  res.json(await handleRazorpayWebhook(req.db, raw, req.get('x-razorpay-signature') ?? undefined));
});

/**
 * One-time setup for a fresh production database: loads the demo company.
 * Needs `Authorization: Bearer $SETUP_SECRET` (or ?key=) and refuses when the database already has users.
 */
router.post('/setup', async (req, res) => {
  const key = String(req.query.key ?? '');
  const ok = bearerOk(req, process.env.SETUP_SECRET) || (process.env.SETUP_SECRET && key.length === process.env.SETUP_SECRET.length && timingSafeEqual(Buffer.from(key), Buffer.from(process.env.SETUP_SECRET)));
  if (!ok) throw new HttpError(401, 'Not allowed.');
  const users = (await req.db.prepare('SELECT count(*) AS n FROM users').get<{ n: number }>())!.n;
  if (users > 0) throw new HttpError(409, 'This database already has data.');
  const { seedInto } = await import('../db/seed');
  const n = Math.min(5000, Math.max(10, Number(req.query.subscriptions ?? process.env.SEED_SUBSCRIPTIONS ?? 2400)));
  res.json(await seedInto(req.db, n));
});

export default router;
