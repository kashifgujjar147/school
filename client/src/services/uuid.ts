/**
 * RFC 4122 version-4 UUID.
 *
 * crypto.randomUUID() only exists in secure contexts (HTTPS or localhost). Plain-HTTP LAN installs
 * (teachers opening http://192.168.x.x on their phones) are a supported deployment, so fall back to
 * crypto.getRandomValues(), which is available in every context and equally random.
 */
export function newId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
