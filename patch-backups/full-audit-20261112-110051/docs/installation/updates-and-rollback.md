# Updates, migrations and rollback

Updates are developed and tested in the master repository, released as a versioned ZIP/tag (`vX.Y.Z`), and
applied to each school **independently**. School data, branding and settings live in the school's database and
`server/.env` / `data/` — none of them are inside the code that gets replaced.

## Release (master repository)
1. `npm ci && npm run typecheck && npm test && npm run build && npm run test:e2e`
2. Bump `version` in the root/server/client `package.json` and `APP_VERSION` in `server/src/config/env.ts`.
3. Add migrations (if the data shape changes) to `server/src/scripts/migrations.ts` — append only, idempotent,
   never deleting school data.
4. `npm run package:zip` → `dist-release/school-management-system-vX.Y.Z.zip`; write release notes.

## Apply to one school
```bash
# 0. announce a short maintenance window; stop the server
# 1. keep the current release folder for rollback
mv /opt/school /opt/school-prev
# 2. extract the new release, carry over configuration and data
unzip school-management-system-vX.Y.Z.zip -d /opt/school
cp /opt/school-prev/server/.env /opt/school/server/.env
mv /opt/school-prev/server/data /opt/school/server/data      # uploads + backups (if stored inside the folder)
cd /opt/school && npm ci && npm run build
# 3. pre-update backup + migrations (aborts if the backup does not verify)
npm run migrate
# 4. start and verify
cd server && node dist/index.js       # then: sign in, System health all green/expected, take a sample report
```
The server also runs pending migrations on start, but `npm run migrate` is preferred because it takes and verifies
a `pre_update` backup first.

## Rollback
1. Stop the server.
2. If the new version ran migrations, restore the `pre_update` backup:
   `npm run backup -- --list` then `npm run backup -- --restore <id> --yes-i-understand` (run from the **new**
   folder, which can read it; it takes a `pre_restore` safety backup first).
3. Switch folders back: `mv /opt/school /opt/school-failed && mv /opt/school-prev /opt/school`, keeping
   `server/.env` and `server/data`.
4. Start the previous version.

Hybrid schools: update the local node and the cloud node to the same version; sync pauses harmlessly while one
side is down.
