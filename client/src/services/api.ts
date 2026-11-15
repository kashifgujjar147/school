import { resolveApiUrl } from './apiUrl';
import { db } from '../offline/db';
import { useAuth } from '../store/auth';
import { useConnectivity } from '../store/connectivity';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
/** Thrown when the server cannot be reached at all (no network / LAN server down). */
export class NetworkError extends Error { constructor() { super('Server unreachable'); } }
/**
 * Thrown when a change could not reach the server and was saved in this device's outbox instead.
 * It is sent automatically, in order, when the connection returns (see sync/outbox.ts).
 */
export class QueuedOfflineError extends Error {
  constructor(public outboxId: string) { super('No internet connection. This change is saved on this device and will be sent automatically when the connection returns.'); }
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]!) : null;
}

export interface Paged<T> { items: T[]; meta: { page: number; pageSize: number; total: number } }
export interface FromCache { fromCache?: { savedAt: number } }

/**
 * Offline reading: the last good response of EVERY authenticated GET /api request is kept per user,
 * so any page opened once online also opens offline. Excluded: sign-in endpoints and the public
 * website (it is meant for visitors on the internet).
 */
const NOT_CACHED = /^\/api\/(auth\/|public\/site|website\/preview)/;
const isCacheable = (url: string) => url.startsWith('/api/') && !NOT_CACHED.test(url);
/** Kept for reference: endpoints cached before full offline mode (all are still cached). */
export const CORE_CACHEABLE = [/^\/api\/academic\/classrooms/, /^\/api\/students(\?|$)/, /^\/api\/students\/[0-9a-f-]{36}$/, /^\/api\/attendance\/roster/, /^\/api\/attendance\/status/, /^\/api\/attendance\/history/, /^\/api\/attendance\/corrections/, /^\/api\/attendance\/sheets\//, /^\/api\/system\/overview/, /^\/api\/public\/config/, /^\/api\/reports\//, /^\/api\/academic\/(classes|sessions|holidays)/, /^\/api\/settings$/,
  // Timetables stay readable offline (teacher's own, a student's class, a parent's child).
  /^\/api\/timetable\/my/, /^\/api\/student\/(me|timetable)/, /^\/api\/parent\/children\/[0-9a-f-]{36}\/timetable/];



async function raw(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const isForm = body instanceof FormData;
  const h: Record<string, string> = { Accept: 'application/json', ...headers };
  if (body !== undefined && !isForm) h['Content-Type'] = 'application/json';
  if (method !== 'GET') { const csrf = readCookie('sms_csrf'); if (csrf) h['X-CSRF-Token'] = csrf; }
  try {
    const r = await fetch(resolveApiUrl(url), { method, headers: h, credentials: 'include', body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
    useConnectivity.getState().setServerReachable(true);
    return r;
  } catch {
    useConnectivity.getState().setServerReachable(false);
    throw new NetworkError();
  }
}

async function parse<T>(r: Response): Promise<{ data: T; meta?: Paged<unknown>['meta'] }> {
  const json = await r.json().catch(() => null) as { ok: boolean; data?: T; meta?: Paged<unknown>['meta']; error?: { code: string; message: string; details?: unknown } } | null;
  if (!r.ok || !json?.ok) {
    if (r.status === 401) useAuth.getState().onUnauthorized();
    throw new ApiError(r.status, json?.error?.code ?? 'HTTP_' + r.status, json?.error?.message ?? `Request failed (${r.status})`, json?.error?.details);
  }
  return { data: json.data as T, meta: json.meta };
}

export async function get<T>(url: string): Promise<T> {
  return (await getWithMeta<T>(url)).data;
}

/**
 * Query parameters that only change paging / searching / sorting. When the exact URL was never cached,
 * a cached response that differs ONLY in these is a safe stand-in (shown with the "saved data" notice).
 * Filters such as classroomId, date, status or a student id must always match exactly.
 */
const LOOSE_PARAMS = ['page', 'pageSize', 'q', 'sort'];
/** Per-path extra parameters that may differ (date ranges of history-style lists). */
const LOOSE_BY_PATH: [RegExp, string[]][] = [[/^\/api\/attendance\/history$/, ['from', 'to']], [/^\/api\/system\/audit$/, ['from', 'to']]];

function splitUrl(url: string) {
  const i = url.indexOf('?');
  return { path: i < 0 ? url : url.slice(0, i), params: new URLSearchParams(i < 0 ? '' : url.slice(i + 1)) };
}
function strictPart(path: string, params: URLSearchParams) {
  const loose = new Set([...LOOSE_PARAMS, ...LOOSE_BY_PATH.filter(([rx]) => rx.test(path)).flatMap(([, k]) => k)]);
  return [...params.entries()].filter(([k]) => !loose.has(k)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
}

type Cached = { data: unknown; meta?: unknown; savedAt: number };

/** Exact cached response, else a compatible one (see LOOSE_PARAMS), else a synthesised register. */
async function fromCache(userId: string, url: string): Promise<Cached | null> {
  const exact = await db.httpCache.get(`${userId}|${url}`);
  if (exact) return exact;
  const { path, params } = splitUrl(url);
  const want = strictPart(path, params);
  const candidates = await db.httpCache.where('key').startsWith(`${userId}|${path}`).toArray();
  const compatible = candidates
    .filter((c) => { const u = splitUrl(c.key.slice(userId.length + 1)); return u.path === path && strictPart(path, u.params) === want; })
    .sort((a, b) => b.savedAt - a.savedAt)[0];
  if (compatible) return compatible;
  // Attendance register for a day that was never downloaded: same classroom's students from any saved
  // day, with no marks. The server re-checks everything (holiday, already submitted...) when it syncs.
  if (path === '/api/attendance/roster' && params.get('classroomId') && params.get('date')) {
    const other = candidates.filter((c) => splitUrl(c.key.slice(userId.length + 1)).params.get('classroomId') === params.get('classroomId')).sort((a, b) => b.savedAt - a.savedAt)[0];
    if (other) {
      const d = other.data as Record<string, unknown>;
      return { savedAt: other.savedAt, data: { ...d, date: params.get('date'), sheet: null, records: [], canSubmit: true, blockedReason: null } };
    }
  }
  return null;
}

let writesSincePrune = 0;
/** Keeps the offline cache bounded: entries older than 60 days go, and at most 3000 per user. */
async function pruneCache(userId: string) {
  await db.httpCache.where('savedAt').below(Date.now() - 60 * 86_400_000).delete();
  const mine = await db.httpCache.where('userId').equals(userId).toArray();
  if (mine.length > 3000) await db.httpCache.bulkDelete(mine.sort((a, b) => a.savedAt - b.savedAt).slice(0, mine.length - 3000).map((c) => c.key));
}

export async function getWithMeta<T>(url: string): Promise<{ data: T; meta?: Paged<unknown>['meta']; fromCache?: { savedAt: number } }> {
  const userId = useAuth.getState().user?.id ?? 'anon';
  const cacheable = isCacheable(url);
  const key = `${userId}|${url}`;
  const served = (hit: Cached) => ({ data: hit.data as T, meta: hit.meta as Paged<unknown>['meta'], fromCache: { savedAt: hit.savedAt } });
  // Offline session (no server session): serve cache only.
  if (useAuth.getState().offlineSession) {
    const hit = cacheable ? await fromCache(userId, url) : null;
    if (hit) return served(hit);
    throw new NetworkError();
  }
  try {
    const out = await parse<T>(await raw('GET', url));
    if (cacheable) {
      await db.httpCache.put({ key, data: out.data, meta: out.meta, savedAt: Date.now(), userId }).catch(() => undefined);
      if (++writesSincePrune >= 50) { writesSincePrune = 0; void pruneCache(userId).catch(() => undefined); }
    }
    return out;
  } catch (e) {
    if (e instanceof NetworkError && cacheable) {
      const hit = await fromCache(userId, url);
      if (hit) return served(hit);
    }
    throw e;
  }
}

export async function getPaged<T>(url: string): Promise<Paged<T> & FromCache> {
  const r = await getWithMeta<T[]>(url);
  return { items: r.data, meta: r.meta ?? { page: 1, pageSize: r.data.length, total: r.data.length }, fromCache: r.fromCache };
}

export type WriteMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** Sends a change straight to the server (no offline queueing). Used by the outbox when it replays. */
export const sendNow = async <T>(method: WriteMethod, url: string, body?: unknown, headers?: Record<string, string>) =>
  (await parse<T>(await raw(method, url, body ?? {}, headers))).data;

/**
 * Changes that need a live answer from the server and therefore never go into the offline queue:
 * sign-in, password resets (the new password is shown once), backups and restore, synchronisation,
 * online payments, timetable generation, test messages / sending the SMS queue, file uploads and imports.
 */
const ONLINE_ONLY = /^\/api\/(auth\/|backups|system\/sync|parent\/.*\/checkout|payments|webhooks|timetable\/generate|sms\/(test|process|whatsapp\/test)|website\/media)|\/reset-password$|\/import(\?|$)|\/photo$|\/test$/;

function describe(method: WriteMethod, url: string) {
  const path = splitUrl(url).path.replace(/^\/api\//, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '…');
  const verb = method === 'DELETE' ? 'Delete' : method === 'POST' ? 'Save' : 'Update';
  return `${verb} · ${path}`;
}

async function write<T>(method: WriteMethod, url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const auth = useAuth.getState();
  const queueable = Boolean(auth.user) && !(body instanceof FormData) && !ONLINE_ONLY.test(url);
  if (!auth.offlineSession || !queueable) {
    try { return await sendNow<T>(method, url, body, headers); } catch (e) { if (!(e instanceof NetworkError) || !queueable) throw e; }
  }
  // No connection: keep the change on this device, to be sent in order when the server is reachable.
  const { enqueueChange } = await import('../sync/outbox');
  const id = await enqueueChange({ method, url, body: (body ?? {}) as Record<string, unknown>, label: describe(method, url), idempotencyKey: headers?.['Idempotency-Key'] });
  throw new QueuedOfflineError(id);
}

export const post = <T>(url: string, body?: unknown, headers?: Record<string, string>) => write<T>('POST', url, body, headers);
export const patch = <T>(url: string, body?: unknown) => write<T>('PATCH', url, body);
export const put = <T>(url: string, body?: unknown) => write<T>('PUT', url, body);
export const del = <T>(url: string, body?: unknown) => write<T>('DELETE', url, body);
export const upload = async <T>(url: string, file: File, field = 'file') => { const f = new FormData(); f.append(field, file); return (await parse<T>(await raw('POST', url, f))).data; };

/** Downloads a file (CSV/XLSX/PDF) and triggers the browser save dialog. */
export async function downloadFile(url: string, fallbackName: string) {
  const r = await raw('GET', url);
  if (!r.ok) await parse(r);
  const blob = await r.blob();
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export { raw as _raw };
