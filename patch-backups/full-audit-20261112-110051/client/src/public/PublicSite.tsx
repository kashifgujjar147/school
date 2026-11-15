import { Link } from 'react-router-dom';
import { MapPin, Phone, Mail, Pin } from 'lucide-react';
import { useGet } from '../hooks/useApi';
import { useT, useFormat } from '../i18n';
import { Spinner, EmptyState } from '../components/ui';
import { LangSwitch } from '../components/Layout';

interface Site {
  name: string; description?: string; logoUrl?: string; heroTitle?: string; heroSubtitle?: string; about?: string;
  contact: { address?: string; phone?: string; email?: string } | null;
  announcements: { _id: string; title: string; body: string; publishedAt: string; pinned: boolean }[];
}

/** Optional, lightweight public website. Independent of the dashboard and teacher portal. */
export function PublicSite() {
  const t = useT(); const f = useFormat();
  const q = useGet<Site>('/api/public/website');
  if (q.isLoading) return <Spinner />;
  if (q.isError || !q.data) return <EmptyState title="404">The school website is not published. <Link className="text-brand underline" to="/login">{t('staffLogin')}</Link></EmptyState>;
  const s = q.data.data;
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-surface-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            {s.logoUrl && <img src={s.logoUrl} alt="" className="h-10 w-10 object-contain" />}
            <span className="text-lg font-semibold">{s.name}</span>
          </div>
          <div className="flex items-center gap-3"><LangSwitch /><Link to="/login" className="btn-secondary">{t('staffLogin')}</Link></div>
        </div>
      </header>
      <section className="bg-gradient-to-br from-brand to-brand/80 text-white">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">{s.heroTitle || s.name}</h1>
          {(s.heroSubtitle || s.description) && <p className="mt-4 max-w-2xl text-lg text-white/85">{s.heroSubtitle || s.description}</p>}
        </div>
      </section>
      <main className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-3">
        <div className="space-y-10 lg:col-span-2">
          {s.about && <section><h2 className="mb-3 text-2xl font-semibold">{t('about')}</h2><p className="whitespace-pre-line leading-relaxed text-ink-soft">{s.about}</p></section>}
          {s.announcements.length > 0 && (
            <section>
              <h2 className="mb-4 text-2xl font-semibold">{t('latestNews')}</h2>
              <div className="space-y-4">
                {s.announcements.map((a) => (
                  <article key={a._id} className="card p-5">
                    <div className="mb-1 flex items-center gap-2 text-xs text-ink-faint">{a.pinned && <Pin className="h-3.5 w-3.5 text-accent" />}{f.date(a.publishedAt)}</div>
                    <h3 className="text-lg font-semibold">{a.title}</h3>
                    <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-soft">{a.body}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
        {s.contact && (
          <aside className="card h-fit space-y-3 p-6 text-sm">
            <h2 className="text-lg font-semibold">{t('contactUs')}</h2>
            {s.contact.address && <p className="flex gap-2"><MapPin className="h-4 w-4 shrink-0 text-brand" />{s.contact.address}</p>}
            {s.contact.phone && <p className="flex gap-2"><Phone className="h-4 w-4 shrink-0 text-brand" /><a className="num" href={`tel:${s.contact.phone}`}>{s.contact.phone}</a></p>}
            {s.contact.email && <p className="flex gap-2"><Mail className="h-4 w-4 shrink-0 text-brand" /><a href={`mailto:${s.contact.email}`}>{s.contact.email}</a></p>}
          </aside>
        )}
      </main>
      <footer className="border-t border-surface-line py-6 text-center text-xs text-ink-faint">© {new Date().getFullYear()} {s.name}</footer>
    </div>
  );
}
