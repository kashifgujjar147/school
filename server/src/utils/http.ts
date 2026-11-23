import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { describeProblems, fieldLabel, fieldProblems } from '@sms/shared';
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
  if (!r.success) throw validationError(r.error);
  return r.data;
}

/**
 * A 400 that names every wrong field and what is wrong, with a format example where it helps
 * ("Please correct this: Due date: Use the date format YYYY-MM-DD, e.g. 2026-12-31").
 * details.fields lists them one by one for forms that highlight fields.
 */
export function validationError(err: ZodError): AppError {
  const fields = fieldProblems(err);
  return new AppError(400, 'VALIDATION', describeProblems(fields), { fields, ...err.flatten() });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    const v = validationError(err);
    return res.status(400).json({ ok: false, error: { code: v.code, message: v.message, details: v.details } });
  }
  const e = err as { code?: number; name?: string; keyValue?: unknown; message?: string; type?: string };
  if (e?.code === 11000) {
    return res.status(409).json({ ok: false, error: { code: 'DUPLICATE', message: 'A record with these details already exists', details: e.keyValue } });
  }
  if (e?.name === 'ValidationError' || e?.name === 'CastError') {
    // Database-level check: name the fields when they are known.
    const paths = Object.keys((err as { errors?: Record<string, unknown> }).errors ?? {});
    const p = (err as { path?: string }).path;
    const names = (paths.length ? paths : p ? [p] : []).map((x) => fieldLabel(x));
    return res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: names.length ? `Please check: ${names.join(', ')}. The value is missing or not in the right format.` : 'Some information is not in the right format. Please check the form.' } });
  }
  if (e?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: { code: 'TOO_LARGE', message: 'Request too large' } });
  // Errors raised by Express itself (e.g. a missing file under /uploads) carry their own 4xx status.
  const httpStatus = (err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode;
  if (typeof httpStatus === 'number' && httpStatus >= 400 && httpStatus < 500) {
    return res.status(httpStatus).json({ ok: false, error: { code: httpStatus === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', message: httpStatus === 404 ? 'Not found' : 'Invalid request' } });
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  // Never leak internals.
  return res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. The error was logged.' } });
}

/**
 * Boolean query-string flag. z.coerce.boolean() turns ANY non-empty string (including "false") into
 * true, so flags are parsed explicitly: true/1 and false/0 only; anything else is a 400.
 */
export const queryBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

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

/**
 * Phone search. Numbers are stored normalised (e.g. +923001112233) while staff type local forms
 * ("0300 1112233"). Match on the digits with leading zeros dropped, so local, spaced and
 * international forms all find the same record. Returns null when the query has fewer than 4 digits.
 */
export function phoneSearchRegex(q: string): RegExp | null {
  const digits = q.replace(/\D/g, '').replace(/^0+/, '');
  return digits.length >= 4 ? new RegExp(escapeRegex(digits)) : null;
}
