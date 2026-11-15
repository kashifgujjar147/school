import { env } from '../config/env.js';
import { Holiday, SchoolSettings } from '../models/index.js';

export type Settings = NonNullable<Awaited<ReturnType<typeof loadSettings>>>;

async function loadSettings() {
  return SchoolSettings.findById('school').lean();
}

let cache: { at: number; value: Settings } | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 10_000) return cache.value;
  const s = await loadSettings();
  if (!s) throw new Error('School is not initialised. Run `npm run init:school`.');
  cache = { at: Date.now(), value: s };
  return s;
}

export function invalidateSettings() { cache = null; }

/**
 * Isolation guard: the database must belong to this installation. Prevents a misconfigured
 * deployment from reading or writing another school's database.
 */
export async function assertInstallIdentity(): Promise<void> {
  const s = await SchoolSettings.findById('school').select('installId').lean();
  if (!s) return; // fresh database; init script will stamp it
  if (s.installId !== env.SCHOOL_INSTALL_ID) {
    throw new Error(`Database belongs to installation "${s.installId}" but this server is configured as "${env.SCHOOL_INSTALL_ID}". Refusing to start.`);
  }
}

/** Expanded list of holiday dates (multi-day holidays expanded) between from and to. */
export async function holidayDates(from: string, to: string): Promise<string[]> {
  const hs = await Holiday.find({ deletedAt: null, date: { $lte: to }, $or: [{ endDate: { $gte: from } }, { date: { $gte: from } }] }).lean();
  const out = new Set<string>();
  for (const h of hs) {
    const end = h.endDate && h.endDate >= h.date ? h.endDate : h.date;
    for (let t = Date.parse(h.date + 'T00:00:00Z'); t <= Date.parse(end + 'T00:00:00Z'); t += 86_400_000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (d >= from && d <= to) out.add(d);
    }
  }
  return [...out].sort();
}
