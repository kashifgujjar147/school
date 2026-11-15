import { useCallback } from 'react';
import { create } from 'zustand';
import { useAuth } from '../store/auth';
import { en, type Dict } from './en';
import { ur } from './ur';

export type Lang = 'en' | 'ur';
const dicts: Record<Lang, Dict> = { en, ur };

function readSavedLang(): Lang | null {
  try { const v = localStorage.getItem('sms.lang'); return v === 'en' || v === 'ur' ? v : null; } catch { return null; }
}

interface LangState { lang: Lang; setLang: (l: Lang) => void }
export const useLang = create<LangState>((set) => ({
  lang: readSavedLang() ?? 'en',
  setLang: (lang) => {
    try { localStorage.setItem('sms.lang', lang); } catch { /* storage unavailable */ }
    applyDir(lang);
    set({ lang });
  }
}));

export function applyDir(lang: Lang) {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
}

export type TKey = keyof Dict;

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  let s: string = dicts[lang][key] ?? en[key] ?? String(key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return s;
}

/** Translator for the current language. Stable between renders (safe in effect dependencies). */
export function useT() {
  const lang = useLang((s) => s.lang);
  return useCallback((key: TKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}

/** Locale-aware number formatting. Urdu UI keeps Western digits (common in Pakistani schools) but RTL layout. */
export function useFormat() {
  const lang = useLang((s) => s.lang);
  // The school's "Date format" setting (Settings → School profile) applies to every date shown.
  const schoolDateFormat = useAuth((s) => s.config?.dateFormat) ?? 'DD/MM/YYYY';
  const locale = lang === 'ur' ? 'ur-PK-u-nu-latn' : 'en-GB';
  return {
    num: (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat(locale).format(n)),
    pct: (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)}%`),
    date: (iso: string | Date | null | undefined, fmt = schoolDateFormat) => {
      if (!iso) return '—';
      const d = typeof iso === 'string' ? (iso.length === 10 ? new Date(iso + 'T12:00:00Z') : new Date(iso)) : iso;
      const dd = String(d.getUTCDate()).padStart(2, '0'); const mm = String(d.getUTCMonth() + 1).padStart(2, '0'); const yy = d.getUTCFullYear();
      return fmt === 'MM/DD/YYYY' ? `${mm}/${dd}/${yy}` : fmt === 'YYYY-MM-DD' ? `${yy}-${mm}-${dd}` : `${dd}/${mm}/${yy}`;
    },
    dateTime: (iso: string | Date | null | undefined) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—')
  };
}
