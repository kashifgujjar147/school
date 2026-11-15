import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { assertInstallIdentity } from '../services/settings.js';
import { createBackup } from '../services/backup.js';
import { pendingMigrations, runMigrations } from './migrations.js';

/** Update procedure step: pre-update backup, then migrations. Run before starting a new version. */
async function main() {
  await connectDatabase();
  await assertInstallIdentity();
  const pending = await pendingMigrations();
  if (!pending.length) { console.log('Database is up to date. No migrations to run.'); return; }
  console.log(`Pending migrations: ${pending.map((m) => `${m.version} (${m.description})`).join(', ')}`);
  const b = await createBackup('pre_update');
  console.log(`Pre-update backup: ${b?.fileName} [${b?.status}]`);
  if (b?.status !== 'verified') throw new Error('Pre-update backup did not verify; aborting update.');
  const n = await runMigrations();
  console.log(`Applied ${n} migration(s).`);
}

main().then(disconnectDatabase).catch(async (e) => { console.error(e.message); await disconnectDatabase(); process.exit(1); });
