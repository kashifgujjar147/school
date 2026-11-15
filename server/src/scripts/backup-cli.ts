import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { assertInstallIdentity } from '../services/settings.js';
import { createBackup, registerBackupFile, restoreBackup } from '../services/backup.js';
import { BackupRecord } from '../models/index.js';

/**
 * Command-line backup for offline installs and cron/Task Scheduler.
 *   npm run backup                      -> create + verify a manual backup
 *   npm run backup -- --list            -> list backups
 *   npm run backup -- --restore <id> --yes-i-understand
 *   npm run backup -- --restore-file <path.ndjson.gz> --yes-i-understand   (e.g. new computer, empty database)
 */
async function main() {
  await connectDatabase();
  await assertInstallIdentity();
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const b of await BackupRecord.find().sort({ createdAt: -1 }).limit(50).lean()) console.log(`${b._id}  ${b.createdAt?.toISOString()}  ${(b.kind ?? '-').padEnd(11)} ${b.status.padEnd(14)} ${b.fileName}`);
    return;
  }
  const fi = args.indexOf('--restore-file');
  if (fi >= 0) {
    if (!args.includes('--yes-i-understand')) throw new Error('Restore replaces ALL current data. Re-run with --yes-i-understand.');
    const rec = await registerBackupFile(args[fi + 1]!);
    if (rec?.status !== 'verified') throw new Error(`Backup file failed verification: ${rec?.error}`);
    console.log(await restoreBackup(rec._id));
    return;
  }
  const ri = args.indexOf('--restore');
  if (ri >= 0) {
    if (!args.includes('--yes-i-understand')) throw new Error('Restore replaces ALL current data. Re-run with --yes-i-understand.');
    console.log(await restoreBackup(args[ri + 1]!));
    return;
  }
  const b = await createBackup('manual', 'cli');
  console.log(`Backup ${b?.fileName}: ${b?.status} (${b?.sizeBytes} bytes, sha256 ${b?.sha256})`);
}

main().then(disconnectDatabase).catch(async (e) => { console.error(e.message); await disconnectDatabase(); process.exit(1); });
