import { env } from '../config/env.js';
import { AcademicSession, NotificationTemplate, SchoolSettings, User } from '../models/index.js';
import { createVersioned } from './repo.js';
import { DEFAULT_TEMPLATES } from './notifications.js';
import { invalidateSettings } from './settings.js';
import { LATEST_SCHEMA } from '../scripts/migrations.js';
import { $in } from '../utils/query.js';

/**
 * Creates the school's base records (settings stamped with SCHOOL_INSTALL_ID, a default academic
 * session, default SMS templates). Creates NO user accounts. Used by `npm run init:school` and, when
 * web setup is enabled (SETUP_TOKEN), at server start on an empty database.
 * Returns false (and changes nothing) when the database is already initialised.
 */
export async function initialiseSchoolData(opts: { name?: string; timeZone?: string } = {}): Promise<boolean> {
  if (await SchoolSettings.exists({ _id: 'school' })) return false;
  const name = opts.name || 'My School';
  const tz = opts.timeZone || 'Asia/Karachi';
  new Intl.DateTimeFormat('en', { timeZone: tz }); // throws on an invalid time zone
  await createVersioned(SchoolSettings, { _id: 'school', installId: env.SCHOOL_INSTALL_ID, name, timeZone: tz, schemaVersion: LATEST_SCHEMA });

  const year = new Date().getFullYear();
  const session = await createVersioned(AcademicSession, { name: `${year}-${year + 1}`, startDate: `${year}-04-01`, endDate: `${year + 1}-03-31`, isDefault: true });
  await SchoolSettings.updateOne({ _id: 'school' }, { defaultSessionId: session._id });

  for (const [event, t] of Object.entries(DEFAULT_TEMPLATES)) {
    await createVersioned(NotificationTemplate, { event, language: 'en', body: t.en, active: true });
    await createVersioned(NotificationTemplate, { event, language: 'ur', body: t.ur, active: true });
  }
  for (const m of [SchoolSettings, User, AcademicSession, NotificationTemplate]) await m.syncIndexes();
  invalidateSettings();
  return true;
}

/** Roles that administer the school. While none of them has an active account, setup is open. */
export const ADMIN_ROLES = ['principal', 'admin'] as const;

/** True while the school has no active, non-deleted principal or admin account. */
export async function setupRequired(): Promise<boolean> {
  return !(await User.exists({ role: $in(ADMIN_ROLES), status: 'active', deletedAt: null }));
}

/** Web setup is offered only when a SETUP_TOKEN is configured AND no administrator exists yet. */
export async function setupAvailable(): Promise<boolean> {
  return Boolean(env.SETUP_TOKEN) && (await setupRequired());
}
