import express, { type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { DB } from './db/connection';
import { errorHandler, notFound, HttpError } from './http';
import { loadUser } from './middleware/auth';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import devRoutes from './routes/dev';
import catalogRoutes from './routes/catalog';
import customerRoutes from './routes/customers';
import discountRoutes from './routes/discounts';
import templateRoutes from './routes/templates';
import subscriptionRoutes from './routes/subscriptions';
import invoiceRoutes, { billingRouter } from './routes/invoices';
import paymentRoutes from './routes/payments';
import reportRoutes from './routes/reports';
import portalRoutes from './routes/portal';
import adminRoutes from './routes/admin';
import publicRoutes from './routes/public';
import systemRoutes from './routes/system';

/** Security headers suitable for a JSON API that also serves the single-page app. */
function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
}

/**
 * Cross-site request forgery guard: browsers send Origin on every POST/PUT/PATCH/DELETE. Changes coming from another
 * site are refused (the session cookie is SameSite=Lax as well). Server-to-server calls without Origin (cron, webhooks) pass.
 */
function sameOrigin(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const host = req.get('x-forwarded-host') ?? req.get('host');
  try {
    const o = new URL(origin);
    const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (o.host === host || allowed.includes(o.origin) || (process.env.NODE_ENV !== 'production' && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(o.host))) return next();
  } catch { /* fall through */ }
  next(new HttpError(403, 'This request came from another site and was refused.'));
}

function requestLog(req: Request, res: Response, next: NextFunction) {
  const started = performance.now();
  const id = req.get('x-vercel-id') ?? randomUUID();
  res.setHeader('X-Request-Id', id);
  res.on('finish', () => {
    if (process.env.VITEST || req.path === '/api/live') return;
    const ms = Math.round(performance.now() - started);
    if (res.statusCode >= 500 || ms > 1500 || process.env.LOG_REQUESTS === '1') {
      console.log(JSON.stringify({ level: res.statusCode >= 500 ? 'error' : ms > 1500 ? 'warn' : 'info', id, method: req.method, path: req.path, status: res.statusCode, ms, user: req.user?.id }));
    }
  });
  next();
}

export function createApp(db: DB | (() => Promise<DB>)) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY ?? (process.env.VERCEL ? 1 : false));
  app.use(requestLog);
  app.use(securityHeaders);
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as Request & { rawBody?: Buffer }).rawBody = buf; } }));
  app.use(cookieParser());
  const getDb = typeof db === 'function' ? db : async () => db;
  app.use(async (req, _res, next) => {
    try { req.db = await getDb(); next(); } catch (e) { next(e); }
  });
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', sameOrigin);
  app.use(loadUser);

  app.use('/api', systemRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/discounts', discountRoutes);
  app.use('/api/templates', templateRoutes);
  app.use('/api/subscriptions', subscriptionRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/billing', billingRouter);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', catalogRoutes);
  if (process.env.NODE_ENV !== 'production' || process.env.DEV_MAILBOX === '1') app.use('/api/dev', devRoutes);

  app.use('/api', (_req, _res, next) => next(notFound('Endpoint')));
  app.use(errorHandler);
  return app;
}

export type App = ReturnType<typeof createApp>;
