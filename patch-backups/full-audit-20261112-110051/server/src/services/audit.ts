import type { Request } from 'express';
import { env } from '../config/env.js';
import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

/** System audit log. Never throws into the request path. */
export async function audit(req: Request | null, action: string, entity?: string, entityId?: string, detail?: unknown) {
  try {
    await AuditLog.create({
      actorId: req?.user?.id, actorName: req?.user?.fullName,
      action, entity, entityId, detail, ip: req?.ip, node: env.NODE_ID
    });
  } catch (err) {
    logger.error({ err, action }, 'audit write failed');
  }
}
