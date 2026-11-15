const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

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