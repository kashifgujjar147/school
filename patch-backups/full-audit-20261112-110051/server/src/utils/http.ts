import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { logger } from './logger.js';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, 'BAD_REQUEST', m, d);
export const unauthorized = (m = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', m);
export const forbidden = (m = 'You do not have permission to do this') => new AppError(403, 'FORBIDDEN', m);
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m: string, d?: unknown) => new AppError(409, 'CONFLICT', m, d);

export function ok<T>(res: Response, data: T, meta?: { page: number; pageSize: number; total: number }, status = 200) {
  res.status(status).json(meta ? { ok: true, data, meta } : { ok: true, data });
}

/** Wraps async handlers so rejections reach the central error handler. */
export const h = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw badRequest('Validation failed', r.error.flatten());
  return r.data;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Validation failed', details: err.flatten() } });
  }
  const e = err as { code?: number; name?: string; keyValue?: unknown; message?: string; type?: string };
  if (e?.code === 11000) {
    return res.status(409).json({ ok: false, error: { code: 'DUPLICATE', message: 'A record with these details already exists', details: e.keyValue } });
  }
  if (e?.name === 'ValidationError' || e?.name === 'CastError') {
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid data' } });
  }
  if (e?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: { code: 'TOO_LARGE', message: 'Request too large' } });
  logger.error({ err, path: req.path }, 'unhandled error');
  // Never leak internals.
  return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. The error was logged.' } });
}

export function pageArgs(q: { page: number; pageSize: number }) {
  return { skip: (q.page - 1) * q.pageSize, limit: q.pageSize };
}

/** Allow-listed sort parsing → mongoose sort object. */
export function sortArg(sort: string | undefined, allowed: string[], fallback: Record<string, 1 | -1>): Record<string, 1 | -1> {
  if (!sort) return fallback;
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  if (!allowed.includes(key)) return fallback;
  return { [key]: desc ? -1 : 1 };
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
