import mongoose from 'mongoose';
import { SchoolSettings } from '../models/index.js';
import { logger } from '../utils/logger.js';

/**
 * Ordered, idempotent data migrations. `schoolsettings.schemaVersion` records what has run.
 * Rules: never delete school data; each step must be safe to re-run; add new steps at the end.
 */
interface Migration { version: number; description: string; up: () => Promise<void> }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Baseline schema (v1.0.0)',
    up: async () => { /* baseline */ }
  },
  {
    version: 2,
    description: 'Ensure all indexes exist (including partial unique attendance indexes)',
    up: async () => {
      for (const name of mongoose.modelNames()) await mongoose.model(name).syncIndexes();
    }
  }
];

export const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export async function pendingMigrations(): Promise<Migration[]> {
  const s = await SchoolSettings.findById('school').select('schemaVersion').lean();
  const current = s?.schemaVersion ?? 0;
  return MIGRATIONS.filter((m) => m.version > current);
}

export async function runMigrations(): Promise<number> {
  const pending = await pendingMigrations();
  for (const m of pending) {
    logger.info({ version: m.version, description: m.description }, 'running migration');
    await m.up();
    await SchoolSettings.updateOne({ _id: 'school' }, { $set: { schemaVersion: m.version } });
  }
  return pending.length;
}
