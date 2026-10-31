import type { Request, Response, NextFunction } from 'express';
import type { DB } from '../db/connection';
import { sessionUser, type Role, type SessionUser } from '../services/auth';
import type { Actor } from '../services/activity';
import { HttpError } from '../http';

declare module 'express-serve-static-core' {
  interface Request { user?: SessionUser; db: DB }
}

export const SESSION_COOKIE = 'sid';

export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    req.user = (await sessionUser(req.db, req.cookies?.[SESSION_COOKIE])) ?? undefined;
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new HttpError(401, 'Please sign in.');
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'You do not have access to this.');
    next();
  };
}

/** The signed-in user; only call after requireAuth/requireRole. */
export function me(req: Request): SessionUser {
  return req.user!;
}

export function actor(req: Request): Actor {
  return req.user ? { id: req.user.id, name: req.user.name } : { id: null, name: 'System' };
}

export const appUrl = (req: Request) => process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`;
