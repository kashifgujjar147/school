# Backup and recovery

## What a backup contains
Every collection of the school's database except short-lived state (sessions, idempotency keys, the backup list
itself), written as gzip-compressed newline-delimited **Extended JSON** (exact types preserved). File name:
`<installId>_<timestamp>_<kind>.ndjson.gz` in `BACKUP_DIR`, file mode 0600.

Uploaded files (logos, student photos) live in `UPLOAD_DIR`; copy that folder together with backups.
Encrypted SMS credentials are included and can only be decrypted with the same `DATA_ENCRYPTION_KEY` — keep
`server/.env` in your secure records.

## Kinds
| kind | created by |
|---|---|
| `manual` | Backups page or `npm run backup` |
| `scheduled` | daily at the configured hour (school time zone); keeps the last *N* |
| `pre_update` | `npm run migrate` before applying migrations |
| `pre_restore` | automatically before any restore |

## Verification
After writing, each backup is verified: SHA-256 of the file recorded, file decompresses and parses, the
installation id matches, and per-collection document counts match. Status becomes `verified` or
`verify_failed`. "Verify" can be re-run any time (e.g. after copying files back from USB).

## Restore
* Dashboard: Backups → ↺ on a **verified** backup. Requires the `backups.restore` permission (principal only by
  default), the principal's password and typing `RESTORE`. A `pre_restore` backup is taken first; all users are
  signed out afterwards.
* Command line (server stopped or running): `npm run backup -- --list`, then
  `npm run backup -- --restore <backupId> --yes-i-understand`.
* A backup from another school's installation is refused.

## Off-site / offline copies
* Cloud: sync `BACKUP_DIR` to object storage nightly (rclone/`aws s3 sync`), plus Atlas cloud backups.
* Local/LAN: copy `BACKUP_DIR` and `UPLOAD_DIR` to a USB drive weekly and to a second computer nightly
  (Windows `robocopy D:\SchoolBackups \\PC2\Backups /MIR`; Linux `rsync -a`).
* **Restore onto a new or replacement computer** (empty database): install the same app version, start MongoDB,
  create `server/.env` with the **same** `SCHOOL_INSTALL_ID` and `DATA_ENCRYPTION_KEY`, copy `UPLOAD_DIR` back, then
  `npm run backup -w server -- --restore-file /path/to/<file>.ndjson.gz --yes-i-understand`.
  The file is checked (installation id, checksum recorded, counts) before anything is replaced. Then start the server.
* Test this procedure on a spare computer once per term.

## Native database backups
For very large databases you may additionally use `mongodump --uri <uri> --db school_a --archive=school_a.gz --gzip`
(MongoDB Database Tools). The app's own backup is the supported path for restore through the dashboard.
