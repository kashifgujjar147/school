# Database model (MongoDB)

The same Mongoose schemas are used against Atlas and local MongoDB Community. All application ids are **UUID
strings** generated where the record is created, so a record keeps its identity across local ↔ Atlas sync.

Synchronised collections carry `version` (int, +1 per write), `updatedByNode`, `deletedAt` (soft delete) and
timestamps. Writes go through `server/src/services/repo.ts` (optimistic concurrency + outbox).

## Collections

| Collection | Purpose | Key indexes / constraints |
|---|---|---|
| `schoolsettings` | singleton `_id:'school'`: identity, branding, policy, SMS automation, website, backup schedule, `installId`, `schemaVersion` | `installId` immutable |
| `secretsettings` | encrypted (AES-256-GCM) SMS provider credentials; never synced, never returned | — |
| `users` | principal/admin/teacher/staff, bcrypt hash (select:false), extra/revoked permissions, lockout | `username` unique |
| `sessions` | `_id = sha256(token)`; CSRF token; expiry; revocation | TTL on `expiresAt` (+7 d) |
| `loginhistory` | success/failure, reason, IP, UA | TTL 400 d; `(userId, at)` |
| `passwordresets` / `passwordresetrequests` | one-time reset links (hashed) / self-service requests | TTL |
| `academicsessions` | years/terms; one default | `name` unique |
| `classes`, `sections` | structure | `name` unique; `(classId,name)` unique |
| `classrooms` | class+section in a session | `(sessionId,classId,sectionId)` unique |
| `teacherassignments` | teacher ↔ classroom; ending sets `endedAt` (history kept); no limits on counts | partial unique `(teacherId,classroomId)` where `endedAt=null` |
| `holidays` | single or multi-day | `date` |
| `students` | profile, placement (classroom/class/section/session), status, custom fields | `admissionNumberLower` unique; `(classroomId,status,fullName)`; `nameNormalized` |
| `studenthistory` | created/transfer/promotion/section change/status | `(studentId, at)` |
| `guardians`, `studentguardians` | contacts; many-to-many with primary flag and alert opt-in | `(studentId,guardianId)` unique |
| `attendancesheets` | one per classroom per date; counts; `clientOpId`; source | **partial unique `(classroomId,date)` where not deleted**; `clientOpId` unique |
| `attendancerecords` | one per student per sheet; `status`, `originalStatus`, `corrected` | partial unique `(classroomId,studentId,date)`; `(studentId,date)`; `(date,status)` |
| `attendancecorrections` | request → review workflow | `(status,requestedAt)`; `clientOpId` unique (partial) |
| `attendanceaudit` | append-only attendance trail | `(recordId,at)`, `(studentId,at)` |
| `notificationtemplates` | per event × language | `(event,language)` unique |
| `notificationjobs` | SMS queue; attempts log capped at 10 | `dedupeKey` unique; `(status,nextAttemptAt)`; `providerMessageId` |
| `notificationlogs` | queued/sent/failed/receipt/… events | `(jobId,at)` |
| `auditlogs` | system audit trail | `(at)`, `(entity,entityId,at)`, `(actorId,at)` |
| `idempotencykeys` | stored responses for retried requests | TTL 45 d |
| `backups` | backup records (file, sha256, counts, verification) | `createdAt` |
| `syncoperations` | outbox (local) / published op log (Atlas) | `(status,nextAttemptAt,createdAt)`; TTL 180 d on `syncedAt` only |
| `syncapplied` | inbox idempotency (ops from other nodes) | TTL 180 d |
| `syncconflicts` | both versions + reason; resolution | `(status,createdAt)` |
| `synccheckpoints` | last success / pull checkpoint | — |
| `announcements` | public website | `publishedAt` |

## Design decisions

* **No unbounded arrays**: guardians, assignments, history, attendance are separate collections; the only arrays
  are small and bounded (`attemptLog` sliced to 10, `workingDays`, permission lists).
* **History is never destroyed**: students are archived/soft-deleted; assignments end instead of being deleted;
  attendance corrections keep `originalStatus` and the audit trail.
* **Duplicate prevention at the database level**: unique indexes for admission numbers, sheet per class/day,
  record per student/day, SMS dedupe key, op ids.
* **Validation in two places**: Zod at the API boundary (shared schemas), Mongoose schema rules (`enum`, `match`,
  `required`, `strict: 'throw'`) at the database layer; `sanitizeFilter` blocks `$` operator injection.
* **Transactions** are used when the server is connected to a replica set (Atlas always; local MongoDB if
  started with `--replSet`, recommended). Without a replica set the code still works because every multi-step
  write is idempotent and protected by unique indexes.

## Website CMS collections

`websiteconfig`, `websitepages`, `websiteitems`, `websitemedia`, `websiterevisions`, `websiteinquiries` — additive, versioned and synchronised like the collections above. Details: [`docs/website/website-cms.md`](../website/website-cms.md).
