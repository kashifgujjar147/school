# Security

This describes what is implemented and its limits. It does **not** claim the system is free of vulnerabilities;
no external penetration test has been performed. See [TEST-REPORT](../TEST-REPORT.md) for what was verified.

## Isolation between schools
Separate database + credentials per installation; database stamped with `SCHOOL_INSTALL_ID` and checked at every
start and every sync connection; no cross-school code paths, no tenant id in requests.

## Authentication
* bcrypt (cost 12) password hashes, `select: false` in the model; policy: ≥10 chars, upper, lower, digit.
* Generic login error; timing equalised for unknown usernames; lockout after `LOGIN_MAX_ATTEMPTS` for
  `LOGIN_LOCK_MINUTES`; per-IP rate limit on login and reset endpoints; full login history.
* Sessions: 256-bit random token in an httpOnly, SameSite=Lax cookie (Secure when `COOKIE_SECURE=true`); only
  `sha256(token)` is stored; absolute expiry (`SESSION_TTL_HOURS`) and idle timeout (`SESSION_IDLE_MINUTES`);
  revocation on logout, password change, role/permission/status change, admin "sign out everywhere", restore.
* Temporary passwords force a change before any other API call (`PASSWORD_CHANGE_REQUIRED`).
* Password reset: admin-issued one-time link (hash stored, 24 h) or temporary password; self-service requests are
  routed to administrators (works without email/internet).
* Offline device sign-in: PBKDF2 verifier only (see [browser offline](../offline/browser-offline.md)).

## Authorisation
* Role → permission matrix in `shared/src/logic/permissions.ts`, plus per-user extra/revoked permissions.
  Permissions are resolved **on the server from the database** on every request; client-sent roles/ids are never trusted.
* Every router uses `can()/canAny()`; teacher data access is additionally scoped to active assignments
  (`assertClassroomAccess`, `classroomScopeFilter`).
* Only a principal can create/modify principal accounts; users cannot change their own role or deactivate themselves;
  restore requires `backups.restore` (principal) + password + typed confirmation; reviewers cannot approve their own
  correction requests (except the principal).
* Package gates (`requireFeature`) return 403 `PACKAGE` for Standard-only APIs on Starter installs, and Standard
  permissions are stripped from every role on Starter.

## Request handling
* CSRF: per-session token, required in `X-CSRF-Token` for every state-changing request, compared in constant time.
* Zod validation on every body/query/param; Mongoose `strict: 'throw'`, `sanitizeFilter` (blocks `$` operator
  injection), user search input regex-escaped, sort fields allow-listed, page size ≤ 200.
* Helmet security headers with a strict CSP (`script-src 'self'`); HSTS when served over HTTPS; CORS limited to
  `APP_URL` + `CORS_ORIGINS` with credentials; JSON body limit 2 MB; global API rate limit.
* Uploads: memory-buffered with size limits, type detected from magic bytes (PNG/JPEG/WebP/ICO), random names,
  path-traversal guarded deletion, static serving with `dotfiles: deny`.
* CSV exports are protected against formula injection.
* Central error handler: no stack traces or internal messages to clients; Pino logs redact cookies, passwords, tokens.

## Secrets
* Database URI, session secret, encryption key and package live only in `server/.env` (never in the client
  bundle, never returned by any API). The dashboard never displays the connection string.
* SMS credentials entered in the dashboard are encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`) in
  `secretsettings`, are write-only (only "set/not set" is shown), are not synchronised and are excluded from
  conflict views. Password hashes are stripped from sync conflict payloads.
* Webhooks: Twilio signature verification (`X-Twilio-Signature`); generic gateways must present a shared token.

## Audit
System audit log for user, settings, student, attendance, SMS, backup, sync and security actions; dedicated
append-only attendance audit trail; login history; all viewable in the Security center.

## Known limitations / operator responsibilities
* Plain-HTTP LAN installs: cookies are not `Secure` and traffic on the Wi-Fi is not encrypted. Use WPA2/3 staff
  Wi-Fi and, preferably, HTTPS on the LAN (see LAN guide).
* No multi-factor authentication yet.
* "Suspicious activity" is a heuristic (≥10 failed sign-ins from one IP in 24 h), not intrusion detection.
* Backups on the same disk as the database do not protect against disk failure — copy them off the machine.
* Rate limits are in-memory per process (fine for a single-process install; use a shared store if you scale out).
* Dependencies should be kept updated (`npm audit`) as part of each release.
