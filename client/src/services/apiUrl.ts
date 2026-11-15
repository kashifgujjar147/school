/**
 * API requests are same-origin (relative /api/...) by default. When the frontend is hosted apart
 * from the backend, the frontend server proxies /api and /uploads to it (see vite.config.ts), so the
 * session and CSRF cookies stay first-party. Calling another domain directly breaks sign-in: browsers
 * do not send the session cookie cross-site and the page cannot read the other domain's CSRF cookie.
 * Set VITE_API_DIRECT=true only for a backend on the SAME site that is reachable without the proxy.
 */
const API_BASE_URL = import.meta.env.VITE_API_DIRECT === 'true' ? (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '') : '';

export function resolveApiUrl(url: string): string {
  if (!API_BASE_URL || /^https?:\/\//i.test(url)) return url;

  if (
    url.startsWith('/api/') || url === '/api' ||
    url.startsWith('/uploads/') || url === '/uploads'
  ) {
    return `${API_BASE_URL}${url}`;
  }

  return url;
}
