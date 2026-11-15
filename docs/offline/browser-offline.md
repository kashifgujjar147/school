# Browser offline operation (PWA + IndexedDB)

Independent of the server mode, each teacher/admin device keeps working when it loses its connection to the
school server (Wi-Fi drop, LAN server rebooting, mobile data loss).

## Layers
| Layer | Implementation | Purpose |
|---|---|---|
| App shell | `client/public/sw.js` + build-time `precache-manifest.json` | the app opens with no connection (all JS/CSS chunks precached) |
| Offline reads | `client/src/services/api.ts` → IndexedDB `httpCache` | last good response of rosters, classrooms, students, history, overview, reports… is served when the server is unreachable, with a visible "Offline: showing data saved at …" banner |
| Offline writes | `client/src/sync/outbox.ts` → IndexedDB `outbox` | attendance submissions and correction requests created offline are queued |
| Drafts | IndexedDB `drafts` | marking in progress survives tab close and device restart |
| Offline sign-in | `client/src/offline/offlineAuth.ts` | password check against a PBKDF2 verifier stored after an online sign-in |
| Connectivity | `client/src/store/connectivity.ts` | browser online flag **and** real server reachability (probe every 20 s) |

## Outbox rules
* Each item's UUID is both the `Idempotency-Key` header and the `clientOpId` in the body. A resend after a lost
  response returns the original result; it can never create a second attendance sheet.
* Statuses: `pending` → `sending` → `synced` (only after the server's 2xx response) — or `conflict` (409: already
  submitted / roster changed), `failed` (other 4xx), `auth_required` (session expired). Nothing is dropped
  silently; the teacher sees the item under *History → Saved on this device* with Retry / Delete.
* Network errors and 5xx responses retry with exponential backoff (5 s → 5 min); the queue also flushes on the
  `online` event, every 30 s while the app is open, and on "Sync now".
* "Retry" after a refusal creates a **new** operation id (the server remembers the refusal under the old key).
* Offline attendance is judged against the time it was recorded on the device (`clientCreatedAt`) for the
  same-day cut-off, but never beyond the server's clock or the backdating allowance.
* A correction request queued offline is only a request: it stays *pending* until a principal reviews it online.

## Offline sign-in security
* After a successful online sign-in, the device stores `{username, salt, PBKDF2-SHA256(password, 210 000 iterations), profile}`.
  No password, no session cookie and no token is written to IndexedDB.
* Offline sign-in unlocks only data already cached on that device. The server still requires a real session for
  every request; when the device reconnects with an expired session, the outbox pauses and the user is asked to
  sign in again before anything is sent.
* Verifiers expire after 30 days without an online sign-in. "Shared device? Sign out & remove offline data" wipes
  cached data, drafts and the verifier for that user. Signing in as another user purges other users' cached data.
* WebCrypto requires HTTPS or `localhost`. On plain-HTTP LAN addresses the browser disables the service worker and
  WebCrypto, so device-level offline sign-in is unavailable there (online use is unaffected). See
  [offline-lan.md](../installation/offline-lan.md#https-on-lan-optional-recommended).

## What is cached
Only GET responses on an allow-list (`CACHEABLE` in `api.ts`), keyed per user. Admin pages show cached data
read-only with the offline banner; actions that need the server show the server-unreachable error rather than
pretending to succeed.
