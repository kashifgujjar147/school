import { schoolMinutes, schoolDate } from '@sms/shared';
import { isTest } from '../config/env.js';
import { BackupRecord } from '../models/index.js';
import { processSmsQueue } from '../services/notifications.js';
import { createBackup, pruneBackups } from '../services/backup.js';
import { getSettings } from '../services/settings.js';
import { syncEngine } from '../sync/engine.js';
import { logger } from '../utils/logger.js';

/**
 * In-process background jobs backed by MongoDB collections (no Redis needed, so they work in
 * offline installations too). Each job is guarded against overlapping runs.
 */
interface Job { name: string; everyMs: number; run: () => Promise<unknown>; busy: boolean; lastRun?: Date; lastError?: string; timer?: NodeJS.Timeout }

const jobs: Job[] = [
  { name: 'sms-queue', everyMs: 20_000, busy: false, run: () => processSmsQueue() },
  {
    name: 'scheduled-backup', everyMs: 10 * 60_000, busy: false, run: async () => {
      const s = await getSettings();
      if (!s.backupSchedule?.enabled) return;
      const now = new Date();
      if (schoolMinutes(now, s.timeZone) < s.backupSchedule.hour * 60) return;
      const today = schoolDate(now, s.timeZone);
      const last = await BackupRecord.findOne({ kind: 'scheduled', status: { $in: ['verified', 'completed'] } }).sort({ createdAt: -1 }).lean();
      if (last && schoolDate(new Date(last.createdAt!), s.timeZone) === today) return;
      await createBackup('scheduled');
      await pruneBackups(s.backupSchedule.keepLast);
    }
  }
];

export const workers = {
  start() {
    if (isTest) return;
    for (const j of jobs) {
      const tick = async () => {
        if (j.busy) return;
        j.busy = true;
        try { await j.run(); j.lastError = undefined; } catch (e) { j.lastError = (e as Error).message; logger.error({ err: e, job: j.name }, 'background job failed'); } finally { j.busy = false; j.lastRun = new Date(); }
      };
      j.timer = setInterval(() => void tick(), j.everyMs);
      setTimeout(() => void tick(), 5_000);
    }
    syncEngine.start();
  },
  async stop() {
    for (const j of jobs) if (j.timer) clearInterval(j.timer);
    await syncEngine.stop();
  },
  status() {
    return jobs.map((j) => ({ name: j.name, everySeconds: j.everyMs / 1000, lastRun: j.lastRun ?? null, lastError: j.lastError ?? null, running: j.busy }));
  }
};
