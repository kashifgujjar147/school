# Hybrid installation — local server + Atlas synchronisation

Daily operation runs on the school's local server (LAN, works without internet). When internet is available the
local server synchronises with the school's Atlas database. Optionally a cloud installation (`APP_MODE=cloud`)
points at the same Atlas database so the principal can check attendance from home.

```
 teachers ─LAN─► local server (APP_MODE=hybrid) ─► local MongoDB
                      │  push/pull when online
                      ▼
               school's Atlas DB ◄── optional cloud server (APP_MODE=cloud, same SCHOOL_INSTALL_ID)
```

## 1. Atlas
Create the school's Atlas database and an app user exactly as in [online.md](online.md). Allow the school's
public IP in *Network Access*.

## 2. Local server `server/.env`
```ini
APP_MODE=hybrid
SCHOOL_INSTALL_ID=school-a          # SAME on every node of this school
NODE_ID=school-a-local-1            # UNIQUE per node
MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0
MONGODB_DB_NAME=school_a
ATLAS_SYNC_URI=mongodb+srv://school_a_app:<pw>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
ATLAS_SYNC_DB_NAME=school_a
SYNC_INTERVAL_SECONDS=60
DATA_ENCRYPTION_KEY=<same value on every node>   # so encrypted settings stay readable
```

## 3. First alignment (once)
* **New school, starting on the local server**: `npm run init:school` locally, start the server, then in
  *Synchronisation* the first run pushes everything, or call `POST /api/system/sync/bootstrap {"direction":"push_all"}`
  (refused if Atlas already holds school data).
* **School already on Atlas, adding a local server**: do NOT run `init:school` locally. With an empty local
  database run `npm run sync:bootstrap -w server -- pull_all`, which copies the school's data from Atlas
  (refused if the local database already holds school data), then start the server normally.
* **School that ran in `local` mode and is now switching to `hybrid`**: changes made in local mode produced no
  sync operations, so copy everything once with `npm run sync:bootstrap -w server -- push_all` (Atlas must be empty).

## 4. Optional cloud node
Deploy as in [online.md](online.md) with `APP_MODE=cloud`, `MONGODB_URI` = the same Atlas URI,
`SCHOOL_INSTALL_ID=school-a`, `NODE_ID=school-a-cloud`. The cloud node writes an op log that the local node pulls.

## Monitoring
*Synchronisation* page (principal/admin): state (online/offline/error), pending / failed / dead operations,
open conflicts, last success, manual "Sync now" and "Retry failed". *System health* shows the same summary.
Status is never shown as synced unless Atlas acknowledged the write.

## Conflict resolution
See [synchronisation](../synchronization/synchronization.md#conflicts). Resolution requires connectivity (so
the remote state is seen before it is overwritten).

## Recovery after connection failure
Nothing to do: operations stay `pending` locally, and the engine resumes automatically with exponential backoff.
Repeatedly failing ops become `dead` after 8 attempts and are listed for an administrator ("Retry failed").
