# School onboarding — new independent installation

Repeat for every new school. Nothing is shared between schools except the application code version.

| # | Step | How | Check |
|---|---|---|---|
| 1 | Prepare a new deployment | New host/app (cloud) or new computer (local/LAN), new folder from the release ZIP; `npm ci && npm run build` | `node -v` ≥ 20.11 |
| 2 | Separate database & credentials | Atlas: new database name + new DB user with `readWrite` on **that database only** (ideally a separate Atlas project). Local: new MongoDB instance on the school's computer | user cannot list other schools' databases |
| 3 | Configure environment | `server/.env` from `.env.example`: unique `SCHOOL_INSTALL_ID`, `NODE_ID`, `MONGODB_*`, new random `SESSION_SECRET` and `DATA_ENCRYPTION_KEY`, `APP_MODE`, `APP_URL` | server starts without config errors |
| 4 | Initialise school settings | `INIT_SCHOOL_NAME="…" INIT_TIMEZONE=Asia/Karachi npm run init:school` | prints installation id + database name |
| 5 | Principal account | The init script creates it with a generated password shown once (or `INIT_PRINCIPAL_PASSWORD`). Hand it over in person; it must be changed at first sign-in | principal signs in, changes password |
| 6 | Branding | Settings → School profile & Branding: name, logo, favicon, colours, address, report header/footer, language, time zone | login page shows the logo |
| 7 | Package | `PACKAGE=starter` or `standard` in `server/.env`, restart | Settings → Package shows it; Starter returns 403 on `/api/sms/*` |
| 8 | Domain (if cloud) | DNS at the school's registrar → host; HTTPS at host/proxy; `APP_URL` updated | `https://…/api/health` = 200 |
| 9 | Initial backup | Backups → Create backup now (status must be **verified**); configure the schedule | backup listed as verified |
| 10 | Verify isolation | (a) `SCHOOL_INSTALL_ID` differs from every other school; (b) temporarily point a test copy of this install at another school's DB → it must refuse to start ("Database belongs to installation …"); (c) the DB user cannot read another school's database (`mongosh` with the app user: `use school_b; db.students.findOne()` → unauthorized) | all three pass |

Then: academic session, classes, sections, classrooms, teachers, assignments, student import (dry-run first),
guardians and SMS (Standard), holidays and working days.

Keep a private record per school: installation id, host, Atlas project/database/user (not the password in plain
text), package, version installed, backup location.
