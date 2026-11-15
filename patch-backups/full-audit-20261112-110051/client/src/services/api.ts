import { db } from '../offline/db';
import { useAuth } from '../store/auth';
import { useConnectivity } from '../store/connectivity';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
/** Thrown when the server cannot be reached at all (no network / LAN server down). */
export class NetworkError extends Error { constructor() { super('Server unreachable'); } }

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]!) : null;
}

export interface Paged<T> { items: T[]; meta: { page: number; pageSize: number; total: number } }
export interface FromCache { fromCache?: { savedAt: number } }

/** GET endpoints whose last response is kept for offline reading. */
const CACHEABLE = [/^\/api\/academic\/classrooms/, /^\/api\/students(\?|$)/, /^\/api\/students\/[0-9a-f-]{36}$/, /^\/api\/attendance\/roster/, /^\/api\/attendance\/status/, /^\/api\/attendance\/history/, /^\/api\/attendance\/corrections/, /^\/api\/attendance\/sheets\//, /^\/api\/system\/overview/, /^\/api\/public\/config/, /^\/api\/reports\//, /^\/api\/academic\/(classes|sessions|holidays)/, /^\/api\/settings$/];

async function raw(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const isForm = body instanceof FormData;
  const h: Record<string, string> = { Accept: 'application/json', ...headers };
  if (body !== undefined && !isForm) h['Content-Type'] = 'application/json';
  if (method !== 'GET') { const csrf = readCookie('sms_csrf'); if (csrf) h['X-CSRF-Token'] = csrf; }
  try {
    const r = await fetch(url, { method, headers: h, credentials: 'same-origin', body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
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

export async function getWithMeta<T>(url: string): Promise<{ data: T; meta?: Paged<unknown>['meta']; fromCache?: { savedAt: number } }> {
  const userId = useAuth.getState().user?.id ?? 'anon';
  const cacheable = CACHEABLE.some((rx) => rx.test(url));
  const key = `${userId}|${url}`;
  // Offline session (no server session): serve cache only.
  if (useAuth.getState().offlineSession) {
    const hit = cacheable ? await db.httpCache.get(key) : undefined;
    if (hit) return { data: hit.data as T, meta: hit.meta as Paged<unknown>['meta'], fromCache: { savedAt: hit.savedAt } };
    throw new NetworkError();
  }
  try {
    const out = await parse<T>(await raw('GET', url));
    if (cacheable) await db.httpCache.put({ key, data: out.data, meta: out.meta, savedAt: Date.now(), userId }).catch(() => undefined);
    return out;
  } catch (e) {
    if (e instanceof NetworkError && cacheable) {
      const hit = await db.httpCache.get(key);
      if (hit) {
        const data = hit.data as T;
        return { data, meta: hit.meta as Paged<unknown>['meta'], fromCache: { savedAt: hit.savedAt } };
      }
    }
    throw e;
  }
}

export async function getPaged<T>(url: string): Promise<Paged<T> & FromCache> {
  const r = await getWithMeta<T[]>(url);
  return { items: r.data, meta: r.meta ?? { page: 1, pageSize: r.data.length, total: r.data.length }, fromCache: r.fromCache };
}

export const post = async <T>(url: string, body?: unknown, headers?: Record<string, string>) => (await parse<T>(await raw('POST', url, body ?? {}, headers))).data;
export const patch = async <T>(url: string, body?: unknown) => (await parse<T>(await raw('PATCH', url, body ?? {}))).data;
export const put = async <T>(url: string, body?: unknown) => (await parse<T>(await raw('PUT', url, body ?? {}))).data;
export const del = async <T>(url: string, body?: unknown) => (await parse<T>(await raw('DELETE', url, body ?? {}))).data;
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
