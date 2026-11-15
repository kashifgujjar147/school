# Architecture

## Deployment model: one codebase, independent installations

```
             master repository (this code)  ──►  versioned release (vX.Y.Z)
                         │
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
  School A install   School B install   School C install
  own server/env     own server/env     own local PC (LAN)
  own Atlas DB+user  own Atlas DB+user  own local MongoDB (+ optional Atlas sync)
```

* No shared database, no central login, no tenant id in the data. Isolation is physical (separate database and
  credentials per school) **and** guarded in code: on first initialisation the database is stamped with
  `SCHOOL_INSTALL_ID`; every server start (`assertInstallIdentity`) and every sync connection
  (`verifyRemoteIdentity`) refuses a database stamped for a different installation.
* Operational settings (name, branding, academic calendar, policies, SMS templates/credentials, website) live in the
  database and are edited in the dashboard. Infrastructure settings (database URI, secrets, package, mode) live in
  the server environment file and are never exposed to the browser.

## Runtime components (per installation)

```
Browser (PWA)                        Node.js server (single process)                 MongoDB
──────────────                       ────────────────────────────────                ───────
React app                            Express REST API (/api)                         cloud: school's Atlas DB
 ├ TanStack Query                     ├ auth, sessions, CSRF, RBAC, package gates     local: MongoDB Community
 ├ IndexedDB (Dexie)                  ├ domain modules (students, attendance, …)
 │  ├ httpCache (offline reads)       ├ repo.ts: versioned writes + sync outbox
 │  ├ outbox (offline writes)         ├ workers: SMS queue, scheduled backups
 │  ├ drafts                          └ sync engine (hybrid only) ─────────────────►  school's Atlas DB
 │  └ offline credential verifier
 └ Service Worker (app shell)        Static: built client + /uploads
```

## Operating modes (`APP_MODE`)

| Mode | Database | Internet needed | Use |
|---|---|---|---|
| `cloud` | school's Atlas | yes (server) | hosted installation; teachers anywhere |
| `local` | local MongoDB | **no** | single computer or school LAN with no cloud |
| `hybrid` | local MongoDB + Atlas sync | only for sync | LAN operation every day, cloud copy/remote access when online |

Browsers additionally work through short outages on their own (PWA + IndexedDB outbox), in any mode.

## Key flows

**Attendance submission**: teacher device generates `clientOpId` (UUID) → `POST /api/attendance/submit` with
`Idempotency-Key` → server validates assignment, date window, full roster → one transaction writes the sheet,
records and audit rows → unique `(classroomId, date)` index makes a second sheet impossible → SMS jobs queued
(Standard). If the server is unreachable the same request is stored in the device outbox and sent later.

**Correction**: teacher requests (record unchanged) → principal approves/rejects → on approval `status` changes,
`originalStatus` is kept, `corrected=true`, and the audit trail records requester, reviewer, timestamps and reason.

**Sync (hybrid)**: every write to a synchronised collection bumps `version` and appends an outbox op in the same
transaction → engine pushes ops to Atlas with version checks, pulls ops from other nodes, and records conflicts
instead of overwriting. See [synchronisation](../synchronization/synchronization.md).

## Source layout

* `shared/src/logic/*` – pure, dependency-free logic (sync decisions, attendance windows/percentages, permissions,
  SMS rendering/phone normalisation, duplicate detection). Unit tested with Node's test runner.
* `server/src/modules/*.routes.ts` – one router per domain; validation with shared Zod schemas.
* `server/src/services/*` – repo (versioned writes), settings, access scoping, notifications, providers, backups,
  reports (PDF/XLSX/CSV).
* `server/src/sync/engine.ts` – hybrid sync engine.
* `client/src/{admin,teacher,public}` – the three experiences; `offline/` and `sync/` – browser offline layer.
