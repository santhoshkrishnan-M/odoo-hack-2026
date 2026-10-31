import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string[]>) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string[]>) => new HttpError(400, message, fields);
export const conflict = (message: string) => new HttpError(409, message);
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`);

export function validate<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string[]> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  throw badRequest('Please check the highlighted fields.', fields);
}

export const PAGE_SIZE = 50;
export function pageOf(query: Request['query']): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1);
  return { page, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
}

/** Route id parameter as a positive integer (anything else is a 404, never a database error). */
export function idParam(req: Request, name = 'id'): number {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw notFound();
  return n;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, fields: err.fields });
    return;
  }
  const e = err as { code?: string; message?: string; type?: string; constraint?: string };
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body is not valid JSON.' });
    return;
  }
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: 'That request is too large.' });
    return;
  }
  // PostgreSQL error codes
  if (e?.code === '23505') {
    res.status(409).json({ error: e.constraint === 'invoices_one_per_period' ? 'That period has already been invoiced.' : 'That record already exists.' });
    return;
  }
  if (e?.code === '23503') {
    res.status(409).json({ error: 'This record is linked to others and cannot be changed that way.' });
    return;
  }
  if (e?.code === '23514' || e?.code === '22003' || e?.code === '22P02' || e?.code === '22007' || e?.code === '22008') {
    res.status(400).json({ error: 'One of the values is not allowed.' });
    return;
  }
  console.error(JSON.stringify({ level: 'error', msg: 'unhandled', path: req.path, method: req.method, error: e?.message, stack: (err as Error)?.stack?.split('\n').slice(0, 5) }));
  res.status(500).json({ error: 'Something went wrong on our side.' });
}

/** Common field schemas */
export const money = z.number().int('Use whole paise.').min(0, 'Cannot be negative.').max(2_000_000_000, 'That amount is too large.');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-31.').refine((s) => !Number.isNaN(Date.parse(s)), 'That date does not exist.');
export const id = z.number().int().positive();
