import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import type { DB } from '../db/connection';
import { normalizeEmail, validatePassword } from '../domain/password';
import { badRequest, conflict, HttpError } from '../http';
import { sendMail } from './mail';
import { logActivity } from './activity';

export type Role = 'admin' | 'staff' | 'customer';
export interface SessionUser { id: number; email: string; name: string; role: Role; customerId: number | null }

const SESSION_DAYS = 7;
const ROUNDS = process.env.VITEST ? 4 : 10;
const RESET_MINUTES = 60;
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function checkPassword(password: string) {
  const problems = validatePassword(password);
  if (problems.length) throw badRequest('Please choose a stronger password.', { password: problems });
}

export async function createUser(db: DB, input: { email: string; password: string; name: string; role: Role; customerId?: number | null }): Promise<SessionUser> {
  checkPassword(input.password);
  const email = normalizeEmail(input.email);
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw conflict('An account with this email already exists.');
  const hash = await bcrypt.hash(input.password, ROUNDS);
  const r = await db.prepare('INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?, ?, ?, ?, ?)')
    .run(email, hash, input.name.trim(), input.role, input.customerId ?? null);
  return { id: r.lastInsertRowid, email, name: input.name.trim(), role: input.role, customerId: input.customerId ?? null };
}

export async function signupCustomer(db: DB, input: { email: string; password: string; name: string; company?: string }): Promise<SessionUser> {
  checkPassword(input.password);
  return db.tx(async (t) => {
    const email = normalizeEmail(input.email);
    if (await t.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw conflict('An account with this email already exists.');
    const c = await t.prepare('INSERT INTO customers (name, email, company) VALUES (?, ?, ?)').run(input.name.trim(), email, input.company ?? '');
    const user = await createUser(t, { ...input, role: 'customer', customerId: c.lastInsertRowid });
    await logActivity(t, { type: 'customer.signed_up', entity: 'customer', entityId: c.lastInsertRowid, customerId: c.lastInsertRowid,
      actor: { id: user.id, name: user.name }, message: `${user.name} created a portal account${input.company ? ` for ${input.company}` : ''}.` });
    return user;
  });
}

export async function verifyLogin(db: DB, email: string, password: string): Promise<SessionUser | null> {
  const u = await db.prepare('SELECT id, email, name, role, customer_id AS "customerId", password_hash, active FROM users WHERE email = ?')
    .get<SessionUser & { password_hash: string; active: number }>(normalizeEmail(email));
  if (!u || !u.active || !(await bcrypt.compare(password, u.password_hash))) return null;
  await db.query('UPDATE users SET last_login_at = now() WHERE id = ?', [u.id]);
  return { id: u.id, email: u.email, name: u.name, role: u.role, customerId: u.customerId };
}

export async function createSession(db: DB, userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await db.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha(token), userId, expires]);
  // Housekeeping: drop this user's expired sessions.
  await db.query('DELETE FROM sessions WHERE user_id = ? AND expires_at < now()', [userId]);
  return token;
}

export async function sessionUser(db: DB, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const u = await db.prepare(`SELECT u.id, u.email, u.name, u.role, u.customer_id AS "customerId" FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token_hash = ? AND s.expires_at > now() AND u.active = 1`).get<SessionUser>(sha(token));
  return u ?? null;
}

export async function endSession(db: DB, token: string | undefined) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = ?', [sha(token)]);
}

export async function requestPasswordReset(db: DB, email: string, appUrl: string) {
  const u = await db.prepare('SELECT id, email, name FROM users WHERE email = ? AND active = 1').get<{ id: number; email: string; name: string }>(normalizeEmail(email));
  if (!u) return;
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_MINUTES * 60e3).toISOString();
  await db.query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha(token), u.id, expires]);
  await sendMail(db, u.email, 'Reset your Brightloop password',
    `Hello ${u.name},\n\nUse this link within ${RESET_MINUTES} minutes to choose a new password:\n${appUrl}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
    'password_reset');
}

export async function resetPassword(db: DB, token: string, password: string) {
  checkPassword(password);
  const hash = await bcrypt.hash(password, ROUNDS);
  await db.tx(async (t) => {
    const row = await t.prepare('SELECT user_id, used_at, expires_at > now() AS fresh FROM password_resets WHERE token_hash = ? FOR UPDATE')
      .get<{ user_id: number; used_at: string | null; fresh: boolean }>(sha(token));
    if (!row || row.used_at || !row.fresh) throw badRequest('This reset link is invalid or has expired. Ask for a new one.');
    await t.query('UPDATE password_resets SET used_at = now() WHERE token_hash = ?', [sha(token)]);
    await t.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, row.user_id]);
    await t.query('DELETE FROM sessions WHERE user_id = ?', [row.user_id]);
  });
}

/**
 * Fixed-window rate limit kept in the database, so it holds across serverless instances.
 * Throws 429 once `limit` hits have been made for `key` within `windowSeconds`.
 */
export async function rateLimit(db: DB, key: string, limit: number, windowSeconds: number) {
  const r = await db.prepare(`INSERT INTO rate_limits (key, window_start, hits) VALUES (?, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ?) THEN 1 ELSE rate_limits.hits + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => ?) THEN now() ELSE rate_limits.window_start END
    RETURNING hits`).get<{ hits: number }>(key, windowSeconds, windowSeconds);
  if ((r?.hits ?? 0) > limit) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}
