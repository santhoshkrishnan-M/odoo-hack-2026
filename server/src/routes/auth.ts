import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validate, HttpError } from '../http';
import { SESSION_COOKIE, requireAuth, me, appUrl } from '../middleware/auth';
import { createSession, endSession, rateLimit, requestPasswordReset, resetPassword, signupCustomer, verifyLogin } from '../services/auth';
import { normalizeEmail } from '../domain/password';

const router = Router();

/** Secure whenever the request arrived over https (directly or via a proxy that says so), so http on localhost still works. */
function setCookie(req: Request, res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 7 * 864e5, path: '/' });
}

const ip = (req: Request) => (req.ip ?? 'unknown').replace(/^::ffff:/, '');
const email = z.string().trim().email('Enter a valid email address.').max(200);

router.post('/signup', async (req, res) => {
  const body = validate(z.object({ name: z.string().trim().min(1, 'Enter your name.').max(120), email, password: z.string().max(200), company: z.string().max(200).optional() }), req.body);
  await rateLimit(req.db, `signup:${ip(req)}`, 10, 3600);
  const user = await signupCustomer(req.db, body);
  setCookie(req, res, await createSession(req.db, user.id));
  res.status(201).json({ user });
});

router.post('/login', async (req, res) => {
  const body = validate(z.object({ email, password: z.string().min(1, 'Enter your password.').max(200) }), req.body);
  await rateLimit(req.db, `login:${ip(req)}`, 30, 900);
  await rateLimit(req.db, `login:${normalizeEmail(body.email)}`, 10, 900);
  const user = await verifyLogin(req.db, body.email, body.password);
  if (!user) throw new HttpError(401, 'Email or password is incorrect.');
  setCookie(req, res, await createSession(req.db, user.id));
  res.json({ user });
});

router.post('/logout', async (req, res) => {
  await endSession(req.db, req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: me(req) });
});

router.post('/forgot', async (req, res) => {
  const body = validate(z.object({ email }), req.body);
  await rateLimit(req.db, `forgot:${ip(req)}`, 10, 3600);
  await rateLimit(req.db, `forgot:${normalizeEmail(body.email)}`, 3, 3600);
  await requestPasswordReset(req.db, body.email, appUrl(req));
  res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
});

router.post('/reset', async (req, res) => {
  const body = validate(z.object({ token: z.string().min(1).max(200), password: z.string().max(200) }), req.body);
  await rateLimit(req.db, `reset:${ip(req)}`, 20, 3600);
  await resetPassword(req.db, body.token, body.password);
  res.json({ ok: true });
});

export default router;
