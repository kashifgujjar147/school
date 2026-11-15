import { createContext, useContext } from 'react';
import type { ItemType, L10n, MediaKind, MediaProvider, PageContent, SiteContent } from '@sms/shared';
import { useLang } from '../../i18n';

/** Types returned by /api/website plus small helpers shared by the Website Management screens. */
export interface PageSummary { _id: string; slug: string; system: boolean; order: number; status: 'draft' | 'published' | 'archived'; dirty: boolean; title: L10n; sections: number; publishedAt: string | null; scheduledAt: string | null; updatedAt: string; version: number }
export interface PageDoc extends PageSummary { draft: PageContent; hasPublished: boolean }
export interface SiteDoc { draft: SiteContent; published: SiteContent | null; dirty: boolean; publishedAt: string | null; version: number; canonicalBase: string; appUrl: string; domain: DomainInfo | null }
export interface DomainInfo { domain: string; token: string; status: 'unverified' | 'verified' | 'failed'; checkedAt: string | null; lastError: string | null; txtName?: string; txtValue?: string }
export interface MediaDoc { _id: string; kind: MediaKind; provider: MediaProvider; source: string; url: string; embedUrl?: string; mime?: string; sizeBytes?: number; width?: number; height?: number; originalName?: string; title: string; category: string; alt: L10n; caption: L10n; archivedAt: string | null; createdAt: string }
export interface MediaConfig { cloudinary: boolean; cloudName: string | null; imageMaxMb: number; videoMaxMb: number }
export interface ItemDoc { _id: string; type: ItemType; slug: string; status: 'draft' | 'published' | 'archived'; featured: boolean; group: string; order: number; data: Record<string, any>; version: number; updatedAt: string } // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Revision { _id: string; scope: 'page' | 'site'; pageId: string | null; pageSlug?: string; title?: string; action: string; createdByName?: string; createdAt: string }
export interface Overview {
  enabled: boolean; publicUrl: string; site: { dirty: boolean; publishedAt: string | null };
  pages: { total: number; published: number; unpublishedChanges: number; drafts: number; scheduled: number };
  items: Record<string, { published: number; total: number }>; media: number; newInquiries: number; cloudinary: boolean;
}

/** Language being edited (content language, independent of the dashboard language). */
export const EditLang = createContext<{ lang: string; defaultLang: string }>({ lang: 'en', defaultLang: 'en' });
export const useEditLang = () => useContext(EditLang);

/** Dashboard copy for the CMS: English with Urdu where provided. */
export function useL() {
  const lang = useLang((s) => s.lang);
  return (en: string, ur?: string) => (lang === 'ur' && ur ? ur : en);
}

export const newId = () => Math.random().toString(36).slice(2, 10);
export const fmtBytes = (n?: number) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function csrf(): string {
  const m = document.cookie.match(/(?:^|; )sms_csrf=([^;]*)/);
  return m ? decodeURIComponent(m[1]!) : '';
}

/** POST a form with upload progress (fetch cannot report it). Resolves with the parsed JSON body. */
export function xhrUpload<T>(url: string, form: FormData, onProgress: (fraction: number) => void, opts: { sameOrigin: boolean }): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    if (opts.sameOrigin) { x.withCredentials = true; x.setRequestHeader('X-CSRF-Token', csrf()); x.setRequestHeader('Accept', 'application/json'); }
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onerror = () => reject(new Error('The upload could not reach the server. Check the connection and try again.'));
    x.onload = () => {
      let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      try { body = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300 && body) resolve((opts.sameOrigin ? body.data : body) as T);
      else reject(new Error(body?.error?.message ?? `Upload failed (${x.status})`));
    };
    x.send(form);
  });
}
