import type { NextFunction, Request, Response } from 'express';
import { IdempotencyKey } from '../models/index.js';
import { badRequest } from '../utils/http.js';

/**
 * Replays the stored response when a client retries a request with the same Idempotency-Key.
 * Offline outboxes rely on this: a submission whose response was lost is retried safely.
 */
export function idempotent(required = true) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = String(req.headers['idempotency-key'] ?? '');
    if (!key) return required ? next(badRequest('Idempotency-Key header is required')) : next();
    if (!/^[A-Za-z0-9-]{8,80}$/.test(key)) return next(badRequest('Invalid Idempotency-Key'));
    const id = `${req.user?.id ?? 'anon'}:${key}`;
    const prev = await IdempotencyKey.findById(id).lean();
    if (prev) {
      res.setHeader('Idempotent-Replay', 'true');
      return res.status(prev.status ?? 200).json(prev.body);
    }
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 500) {
        IdempotencyKey.create({ _id: id, route: req.originalUrl, status: res.statusCode, body }).catch(() => undefined);
      }
      return json(body);
    };
    next();
  };
}
