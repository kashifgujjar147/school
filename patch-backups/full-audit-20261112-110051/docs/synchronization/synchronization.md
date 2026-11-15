# Synchronisation (hybrid mode)

Implemented in `server/src/sync/engine.ts`; decision logic in `shared/src/logic/sync.ts` (unit tested).

## Data model
Every synchronised document has a stable UUID `_id`, an integer `version` (+1 on every write), `updatedByNode`,
`deletedAt` (soft delete) and timestamps. Every write through `repo.ts` appends an **operation**:

```
{ _id: opId (UUID, idempotency key), collectionName, docId, kind: upsert|delete,
  baseVersion, newVersion, snapshot (full document), nodeId, status, attempts, nextAttemptAt, lastError }
```
In hybrid mode ops start `pending`; in cloud mode they are written already `synced` as a pull log for other nodes;
in local mode none are written.

## Push (local → Atlas)
For each due op in creation order:
1. If Atlas `syncapplied` has the opId → already applied (lost acknowledgement) → mark synced.
2. Load the Atlas copy and run `decideApply(op, target)`:
   * missing → insert
   * `target.version == baseVersion` → replace (guarded by `version` in the filter)
   * identical content already there → skip
   * `target.version > baseVersion` → **conflict** (never overwrite newer data)
   * duplicate natural key on insert (e.g. two different sheets for the same class+date) → **conflict**
3. Record opId in Atlas `syncapplied` and copy the op into Atlas `syncoperations` (so other nodes can pull).
4. Mark the local op `synced` only after steps 2–3 succeed.

Per-document ordering is preserved: while an op is in conflict/dead, later ops for the same record wait.
Network errors stop the run (state `offline`, ops stay pending). Other errors retry with exponential backoff;
after 8 attempts an op becomes `dead` (dead-letter) and is listed for an administrator.

## Pull (Atlas → local)
Reads Atlas `syncoperations` from other nodes since the last checkpoint minus a 10-minute overlap (clock-skew
tolerance; re-reads are harmless because applied opIds are remembered locally in `syncapplied`). Applies with the
same rules; a document that has an un-pushed local change is a conflict.

## Conflicts
Stored in `syncconflicts` with **both versions** and the reason; nothing is overwritten. An administrator with
`sync.manage` resolves on the *Synchronisation* page:
* **Keep this school server version** / **Keep cloud version** / merged (API) — the chosen document is written to
  both sides with `version = max(local, remote) + 1`, an op is published so other nodes converge, superseded ops
  are closed with a note, and the decision is audited.
* Natural-key conflicts (two sheets for one class/day) — the losing copy is **soft-deleted** (kept for audit) on
  its side, together with its records; then the winner is pushed/pulled.
* Resolution requires connectivity so the remote state is seen first.

## Source-of-truth rules
| Data | Rule |
|---|---|
| Attendance sheets/records | created where taken; unique per class/day enforced on both sides; changes only via approved corrections; conflicts manual |
| Corrections | requests can be created offline; approval only by an authorised reviewer on the node where they review; the record change syncs as a normal versioned update |
| Students, classrooms, assignments, users | either side may edit; version check; conflicts manual (never auto-merged) |
| Settings, holidays, templates, guardians | either side; version check; conflicts manual |
| SMS jobs | **not synchronised**. A job is queued and sent only by the node where the attendance was submitted/corrected (so two nodes can never send the same alert; `dedupeKey` is unique per node). A local/hybrid node sends whenever it has internet. Delivery receipts can only reach a node whose `APP_URL` is publicly reachable; on a LAN node, jobs stay `sent` (accepted by the provider) and are never shown as `delivered` without a receipt |
| Sessions, login history, audit logs, idempotency keys, backups | per node, not synchronised |

## Guarantees and limits
* No silent overwrite of a newer record by an older copy; no success reported before Atlas acknowledged.
* Idempotent: replays after crashes or lost responses do not duplicate records, students or SMS.
* Limits: the op log in Atlas is kept 180 days — a node offline longer must be re-aligned with
  `sync:bootstrap` (to an empty side) or a backup restore. Ordering across nodes uses timestamps with a 10-minute
  overlap; keep server clocks NTP-synchronised. Very large backlogs are processed 200 ops per batch.
