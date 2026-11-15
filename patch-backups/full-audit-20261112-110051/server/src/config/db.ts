import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

let connected = false;

export async function connectDatabase(uri = env.MONGODB_URI, dbName = env.MONGODB_DB_NAME): Promise<void> {
  mongoose.set('strictQuery', true);
  mongoose.set('sanitizeFilter', true); // blocks $-operator injection in query filters
  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: env.APP_MODE === 'cloud' ? 15_000 : 5_000,
    maxPoolSize: 20,
    autoIndex: true
  });
  connected = true;
  logger.info({ dbName, mode: env.APP_MODE }, 'database connected');
  mongoose.connection.on('disconnected', () => logger.warn('database disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('database reconnected'));
}

export async function disconnectDatabase(): Promise<void> {
  if (connected) await mongoose.disconnect();
  connected = false;
}

export function dbState(): 'connected' | 'connecting' | 'disconnected' | 'disconnecting' {
  return (['disconnected', 'connected', 'connecting', 'disconnecting'] as const)[mongoose.connection.readyState] ?? 'disconnected';
}

/** Transactions require a replica set (Atlas always; local MongoDB only if started as a replica set). */
export async function supportsTransactions(): Promise<boolean> {
  try {
    const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
    return Boolean(hello.setName);
  } catch {
    return false;
  }
}

/**
 * Runs fn in a transaction when supported, otherwise directly. Callers must keep their writes
 * idempotent (we do: unique indexes + idempotency keys) so the non-transactional path is safe.
 */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!(await supportsTransactions())) return fn(undefined);
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally {
    await session.endSession();
  }
}
