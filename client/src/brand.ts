/**
 * Brand identity of this installation: The Alpha School System — 47 Campus.
 * The school's settings (name, logo, colours) always win; these are the fallbacks used before
 * settings load, offline on first run, or when no logo has been uploaded.
 */
export const BRAND = {
  name: 'The Alpha School System — 47 Campus',
  logo: '/brand/alpha-logo.png',
  tagline: 'Learn, Grow, Succeed'
} as const;

/** "The Alpha School System — 47 Campus" → ["The Alpha School System", "47 Campus"]. */
export function splitSchoolName(name: string | null | undefined): [string, string | null] {
  const n = (name ?? '').trim() || BRAND.name;
  const parts = n.split(/\s+[—–|·-]\s+/);
  return parts.length > 1 ? [parts[0]!, parts.slice(1).join(' · ')] : [n, null];
}

export const logoOf = (url: string | null | undefined) => url || BRAND.logo;
