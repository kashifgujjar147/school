# Test and verification report — v1.0.0

**Environment constraint:** this project was written in a sandbox where the npm registry was unreachable
(package installation blocked). The required stack (Express, Mongoose, MongoDB, Vite, React, Tailwind, Dexie,
Vitest, Supertest, Playwright, …) could therefore **not be installed**, and nothing that depends on it was built
or executed. No result below is fabricated; anything not executed is marked as such.

## A. Executed here — results

| Check | Command | Result |
|---|---|---|
| Syntax of every TypeScript/TSX file (shared, server, client, tests) | `node scripts/verify-syntax.mjs` | **107 files, 0 syntax errors** (TypeScript 6.0.3 parser) |
| Shared core-logic unit tests (sync conflict decisions & idempotency, backoff, permissions & package gating, attendance percentages / cut-off / holidays / time zones, SMS templates / phone normalisation / Urdu segments / dedupe keys, duplicate-student matching) | `npm run test:logic` | **23 tests, 23 passed, 0 failed** (Node test runner via tsx) |
| Cross-module consistency type-check: real `tsc --strict` over all project code with third-party packages replaced by `any` stubs (catches wrong imports/exports, wrong property names and argument types between our own modules, missing i18n keys) | ad-hoc (`/tmp/tc`, see section D) | After fixing 9 genuine issues it found, **0 errors in project-internal types**; remaining diagnostics are artefacts of the stubs only (e.g. Express `Request` resolving to the DOM type) |
| English ↔ Urdu dictionary parity | script | **349 / 349 keys** in both |
| Service-worker syntax | `node --check client/public/sw.js` | OK |
| API reference generated from source | `node scripts/gen-api-docs.mjs` | **104 endpoints**, all with resolved paths and permissions |
| ZIP integrity | `npm run package:zip` + `unzip -t` + re-extract & re-run syntax and logic tests | see section E |

## B. Written but NOT executed (requires `npm install`)

| Suite | Location | Covers |
|---|---|---|
| Server integration (Vitest + Supertest + in-memory MongoDB **replica set**) | `server/tests/auth-permissions.test.ts` | login/logout/me, generic errors, lockout, suspension revokes sessions, CSRF, forced password change, single-use reset links, teacher denied admin APIs, teacher classroom scoping, admin cannot create principal/restore, client-sent role ignored, Starter package blocks Guardians/SMS/notification report, install-id isolation guard |
| | `server/tests/students-attendance.test.ts` | student create, exact & likely duplicates, search/pagination, transfer keeps history & attendance, sync op + version bump on writes, optimistic concurrency 409, attendance submit + counts + audit, idempotent replay (same & new key), duplicate class/day 409, ROSTER_CHANGED, unassigned teacher 403, future date 422, correction request → approve (original preserved, audit trail, recount), teacher cannot review, double review 409, rejection keeps record |
| | `server/tests/sms-sync.test.ts` | SMS queued once per guardian, re-enqueue no duplicate, no provider → `blocked_config` never `sent`, offline → stays pending with no attempt consumed then `sent` (not `delivered`) when online, Starter never queues; **hybrid sync against a second in-memory MongoDB acting as Atlas**: push + idempotent re-push, conflict detected instead of overwrite + keep_local resolution converges versions, pull from another node, offline run reports `offline` and never success, refuses another school's Atlas DB |
| | `server/tests/reports-backups.test.ts` | summary report from real records, CSV/XLSX/PDF exports, teacher report scoping, missing-submission detection, verified backup + restore (password + phrase) + pre_restore backup, restore-from-file onto an empty database |
| Client (Vitest + RTL + fake-indexeddb) | `client/src/offline/offline.test.ts` | offline verifier never stores the password, accept/reject/expiry, outbox: network failure stays pending, synced only after server 2xx with Idempotency-Key + X-Offline-Origin, 409 kept as conflict, 401 → auth_required, offline session never sends, requeue uses a new id |
| | `client/src/i18n/i18n.test.tsx` | dictionary parity, interpolation, Urdu sets `dir=rtl` / `lang=ur` |
| End-to-end (Playwright, desktop + mobile) | `tests/e2e/app.spec.ts` | principal dashboard with real totals and navigation, teacher online submission, **teacher offline submission (context.setOffline) → pending → reconnect → synced**, Urdu RTL switch, teacher blocked from admin pages |
| Builds / type-checks | `npm run typecheck`, `npm run build` | not run |

### Offline acceptance tests (spec §17) — where each is covered
| # | Requirement | Covered by | Executed? |
|---|---|---|---|
| 1 | starts in local offline mode | `APP_MODE=local` server start; e2e server runs `APP_MODE=local` | no |
| 2 | local authentication | server auth tests run against local MongoDB; client offline verifier tests | no |
| 3 | students accessible locally | e2e + API tests on local DB | no |
| 4 | mark attendance without internet | e2e offline test | no |
| 5 | survives restart | local MongoDB persistence; drafts/outbox in IndexedDB (client tests) | no |
| 6 | LAN devices reach local server | **manual** (see LAN guide); needs real network | no |
| 7 | pending operations visible | client outbox tests; e2e "waiting to sync" | no |
| 8–10 | reconnect, sync, no duplicates | e2e offline test; server idempotency tests; sync push re-run test | no (logic: **yes**, §A) |
| 11 | conflicts detected | sync conflict test; `decideApply` unit tests | logic: **yes** |
| 12 | failed sync retried | engine `retryFailed`, backoff unit test | logic: **yes** |
| 13 | no false success | sync offline test; outbox network-failure test | no |
| 14 | SMS pending offline, sent online | sms offline test | no |

## C. Not implemented / known gaps
* Multi-factor authentication.
* PDF reports render Latin script by default; Urdu text in PDFs needs `REPORT_FONT_PATH` pointing to an
  Arabic-script TTF, and PDFKit's Arabic shaping is limited (Excel/CSV exports handle Urdu correctly).
* Delivery receipts only reach installations with a public `APP_URL`; on LAN-only nodes SMS stay `sent`
  (accepted) — they are never shown as delivered without a receipt.
* No email channel (by design: SMS only; password resets are admin-issued).
* Real SMS sending and Twilio signature validation are implemented but untested against live providers
  (require credentials).
* Real MongoDB Atlas connectivity is untested (requires credentials); the Atlas code path is the same driver
  path exercised by the in-memory replica-set tests once they are run.

## D. Reproducing the checks
```bash
npm install
npm run verify:syntax
npm run test:logic
npm run typecheck        # full type-check with real types — not yet run
npm test                 # server + client suites — not yet run
npm run build
npx playwright install chromium && npm run test:e2e
```

## E. Package verification
* `npm run package:zip` → `dist-release/school-management-system-v1.0.0.zip`
* `unzip -t`: no errors; 187 files; contains `.env.example` and `.gitignore`; contains **no** `.env`,
  `node_modules`, `dist`, data or test artefacts.
* Extracted into an empty folder and re-ran `verify-syntax` (107 files, 0 errors) and the shared logic tests
  (23/23 passed) from the extracted copy.
* **Lockfiles are not included**: `package-lock.json` can only be generated by `npm install` with registry
  access, which was blocked. Run `npm install` once and commit the generated `package-lock.json`; use `npm ci`
  for every school deployment after that so all schools get identical dependency versions.
