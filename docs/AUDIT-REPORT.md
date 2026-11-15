# Full-stack functionality audit — 2026-11-12

Scope: every page, every API route, the frontend↔backend contract, routing/permissions, business rules and
database integrity of this installation's codebase. All testing ran against **disposable in-memory MongoDB**
(Vitest/Supertest and the Playwright e2e server). The live database configured in `.env` was never touched.

## 1. Product scope (what "every module" means here)

This system is an attendance-centred school administration product. Modules present in the code:
students (+ import/export, custom fields, photos, transfers, promotion), classes/sections/classrooms,
academic sessions & holidays, teacher assignments, users & permissions, attendance marking (online and
offline), corrections with audit trail, guardians & SMS alerts (Standard package), reports
(JSON/CSV/XLSX/PDF), settings & branding, public website & announcements, security center, health,
backups/restore, hybrid Atlas sync.

**Not present in the codebase:** exams/results, fees/payments, payroll, timetables, a separate parent
portal. These were not added: building whole new modules would introduce new business rules that
nobody has specified, not finish existing ones.

## 2. Frontend audit

| Page | Result |
|---|---|
| Overview | Real data from `/api/system/overview`; 30 s refresh. Trend window fixed to school time zone (§8). |
| Students / profile | **Edit was silently broken** for students created with blank optional fields (§8). Move dialog errors were hidden behind the modal (fixed). Archive/restore/delete/photo/import/export verified. |
| Classrooms | Add-classroom offered **archived** classes/sections (fixed). Promotion dialog state updates made functional. Assign/end teacher, archive/restore, class/section edit verified. |
| Users | **No way to edit an existing user's name/email/phone** (implemented). Reset-link / temporary-password buttons **failed silently** on error (fixed). Controls now disabled for view-only users and for principal accounts when the viewer is not a principal. |
| Guardians | Create/edit/search/link/unlink/primary verified (server fixes in §8). |
| SMS | Template editor was offered to view-only users and posted the whole DB document (now gated to `sms.manage`, sends only schema fields). Queue search fixed server-side. |
| Attendance monitor, Corrections, Reports, Settings, Website, Security, Health, Backups, Sync | Every action has success and error handling; no dead buttons, placeholders or fake success messages found. |
| Teacher: home, mark, history, corrections | Online + offline submission, review, history and correction requests verified by e2e (desktop + phone). |

Sweep results: no `TODO`/placeholder actions, no empty click handlers, no mock data in application code.

## 3. Backend audit

All 13 route modules read in full. Validation (Zod) on every body/query; permissions from the DB role;
CSRF on all mutating requests; consistent `{ ok, data | error }` envelope; duplicate keys → 409; Zod/Cast
errors → 400; unknown → 500 with logging. Versioned writes (optimistic concurrency + sync outbox) used
throughout. No route conflicts (`/students/:id` vs `/students/export/file` etc. differ in segment count).

## 4. API inventory

[`docs/api/inventory.md`](api/inventory.md) — regenerated from source: **104 endpoints**, each with method,
path, purpose, permission, frontend consumer and the test files that verify it. **0 endpoints are
"not covered"** by tests. Endpoints with no UI consumer, all intentional: the two SMS delivery-receipt
webhooks (called by providers), `POST /api/students/check-duplicates` (the create flow returns duplicates
via 409 instead) and `POST /api/system/sync/bootstrap` (documented as an API/CLI one-time operation in
`installation/hybrid.md`).

## 5. Frontend ↔ backend integration

Methods, URLs, bodies, query params, pagination (`meta.total`), CSRF header and error envelopes match on
every call. Mismatches found and fixed on the correct side:
- Student edit form sent `null` values into a client schema that rejects `null` (client fix — the server
  contract was right).
- SMS template save posted DB metadata (`_id`, `version`, timestamps) — now sends the schema fields only.

## 6. Routes and navigation

Every admin route is wrapped in the same permission the sidebar uses; teacher routes require
`attendance.mark`; unknown paths render 404; deep links survive refresh (server serves the SPA for
non-API paths — verified by e2e reloads); `next=` redirects are sanitised against open redirects.

## 7. Database & business logic

Unique indexes back every duplicate rule (username, admission no., class name, section per class,
classroom per session/class/section, one open assignment per teacher/classroom, one register per
classroom/date). Soft deletes keep history; attendance corrections preserve the original status and
write an audit trail. Defects found are listed in §8.

## 8. Defects found and fixed

| # | Defect | Fix |
|---|---|---|
| 1 | Editing a student created with blank optional fields **did nothing** (client Zod rejected stored `null`s on fields with no error slot). | Normalise nulls when seeding the form; any validation failure is now shown. |
| 2 | SMS queue search with < 4 digits or no digits **returned every job**. | Short fragments filter; non-numeric queries match nothing. |
| 3 | Guardian edit that changed `phone` **erased the stored alternate phone**; an `altPhone`-only edit skipped validation/normalisation. | Each number is normalised and changed only when sent. |
| 4 | Unlinking the primary guardian left **no primary** while other guardians remained, so the student lost its contact phone (student phone search, duplicate checks). | Oldest remaining link becomes primary. SMS alerts were not affected (they use `receivesAlerts`). **Behaviour change:** an existing test asserted the old result and was updated. |
| 5 | `unlock` and `revoke-sessions` returned success for **non-existent users** and let an admin act on **principal** accounts. | 404 for unknown users; same principal rule as edit/reset. |
| 6 | Users could not edit an existing account's name/email/phone (API supported it, no UI). | Profile editor added. |
| 7 | Bulk promotion into the **same** classroom wrote promotion history for every student. | 400. |
| 8 | Classrooms could be created on **archived** classes/sections (UI offered them, API accepted). | Filtered in UI, rejected by API. |
| 9 | Submissions report flagged **archived classrooms as MISSING** every day. | Archived classrooms excluded. |
| 10 | Percentage report listed archived/transferred students with no records as blank rows. | Only active students, plus others who have records in range. |
| 11 | Overview 14-day trend started from a UTC date while "today" is school time. | Both ends in school time. |
| 12 | Reset-password buttons / move dialog / template editor failed silently or were offered to users who cannot use them. | See §2. |

## 9. Files changed

Server: `modules/sms.routes.ts`, `modules/students.routes.ts`, `modules/academic.routes.ts`,
`modules/users.routes.ts`, `modules/guardians.routes.ts`, `modules/reports.routes.ts`,
`modules/system.routes.ts`. Client: `admin/Students.tsx`, `admin/StudentProfile.tsx`,
`admin/Classrooms.tsx`, `admin/Users.tsx`, `admin/Sms.tsx`. Tests: new `server/tests/audit-fixes.test.ts`
(12 tests); `server/tests/workflows.test.ts` (guardian assertion, see #4); `tests/e2e/workflows.spec.ts`
(SMS heading locator; new user-profile test). Docs: this file, regenerated `api/inventory.md`.

## 10. Tests actually executed (all against in-memory MongoDB)

| Suite | Result |
|---|---|
| `npm run typecheck` (shared, server, client) | 0 errors |
| Shared logic (`node --test`) | 23 / 23 passed |
| Server integration (Vitest + Supertest, replica set) | **106 / 106 passed** (8 files) |
| Client (Vitest + RTL + fake-indexeddb) | 18 / 18 passed |
| `npm run build` | OK |
| Playwright e2e (desktop + Pixel 7) | **21 / 21 passed** — includes offline submit → reconnect → sync |

Baseline before this audit: 1 server test failing (defect #2) and 2 e2e tests failing (defect #1 and an
ambiguous test locator).

## 11. Remaining limitations

- Exams, fees, payroll, timetables and a parent portal do not exist (see §1).
- Not testable here: real SMS providers and Twilio signatures, real Atlas connectivity, LAN access from
  other devices (manual, see `installation/offline-lan.md`).
- Ending a teacher assignment (× on the classroom card) has no confirmation step; history is kept and the
  teacher can be re-assigned.
- Known gaps already listed in `TEST-REPORT.md` §C (no MFA; Urdu in PDFs needs `REPORT_FONT_PATH`).
- One e2e promotion-dialog failure seen in an earlier run did not reproduce in two full runs after this
  audit; the dialog's state updates were made functional, but the original root cause was not confirmed.
