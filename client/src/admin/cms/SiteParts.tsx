import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { BODY_FONTS, HEADING_FONTS, SITE_PARTS, THEME_BACKGROUNDS, THEME_PRESETS, WEBSITE_LANGUAGE_NAMES, WEBSITE_LANGUAGES, contrastRatio, stableEqual, themeCssVars, type SiteContent, type SitePartKey } from '@sms/shared';
import { useGet } from '../../hooks/useApi';
import { useFormat } from '../../i18n';
import { useAuth } from '../../store/auth';
import { patch, post } from '../../services/api';
import { Alert, Badge, Button, Card, Checkbox, ConfirmDialog, PageHeader, Select, Spinner, ErrorState, errorMessage } from '../../components/ui';
import { EditLang, newId, useL, type SiteDoc } from './api';
import type { Field } from './defs';
import { FormFields, LangTabs } from './fields';
import { RevisionList } from './Builder';

/** Draft → publish bar shared by every site-wide settings screen. */
export function SitePublishBar({ site, onChanged }: { site: SiteDoc; onChanged: () => Promise<unknown> }) {
  const L = useL(); const f = useFormat();
  const canPublish = useAuth((s) => s.can('website.publish'));
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState(''); const [history, setHistory] = useState(false); const [discard, setDiscard] = useState(false);
  const run = async (name: string, fn: () => Promise<unknown>) => { setBusy(name); setErr(''); try { await fn(); await onChanged(); } catch (e) { setErr(errorMessage(e, 'Failed')); } finally { setBusy(null); } };
  return (
    <div className="mb-5 space-y-3">
      <div className={clsx('flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm', site.dirty ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50')}>
        <p>{site.dirty ? L('Saved changes to navigation, footer, contact, theme, SEO or languages are waiting to be published.', 'محفوظ شدہ تبدیلیاں شائع ہونے کی منتظر ہیں۔') : <>{L('The live website uses these settings.')}{site.publishedAt && <span className="text-ink-soft"> {L('Last published')} {f.dateTime(site.publishedAt)}</span>}</>}</p>
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href="/site?preview=1" target="_blank" rel="noreferrer">{L('Preview draft', 'مسودہ دیکھیں')}</a>
          <Button variant="secondary" onClick={() => setHistory(true)}>{L('History')}</Button>
          {site.dirty && site.published && <Button variant="secondary" onClick={() => setDiscard(true)}>{L('Discard')}</Button>}
          {canPublish && <Button disabled={!site.dirty} loading={busy === 'publish'} onClick={() => run('publish', () => post('/api/website/site/publish'))}>{L('Publish site settings', 'ترتیبات شائع کریں')}</Button>}
        </div>
      </div>
      {err && <Alert kind="error">{err}</Alert>}
      {history && <RevisionList scope="site" canRestore={canPublish} onClose={() => setHistory(false)} onRestored={async () => { await onChanged(); setHistory(false); }} />}
      <ConfirmDialog open={discard} danger title={L('Discard unpublished settings?')} message={L('The draft goes back to what is live now.')} loading={busy === 'discard'} onCancel={() => setDiscard(false)} onConfirm={() => run('discard', () => post('/api/website/site/discard')).then(() => setDiscard(false))} />
    </div>
  );
}

/** Loads the site configuration and edits one part of it with Save draft. */
function PartEditor<K extends SitePartKey>({ part, title, subtitle, localized = true, children }: { part: K; title: string; subtitle?: string; localized?: boolean; children: (value: SiteContent[K], set: (v: SiteContent[K]) => void, site: SiteDoc) => ReactNode }) {
  const L = useL(); const qc = useQueryClient();
  const site = useGet<SiteDoc>('/api/website/site');
  const [value, setValue] = useState<SiteContent[K] | null>(null);
  const [lang, setLang] = useState('en');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const s = site.data?.data;
  useEffect(() => { if (s) setValue(s.draft[part]); }, [s?.version, part]); // eslint-disable-line react-hooks/exhaustive-deps
  if (site.isLoading || (!value && !site.isError)) return <Spinner />;
  if (!s || !value) return <ErrorState error={site.error} onRetry={() => void site.refetch()} />;
  const refetch = async () => { await site.refetch(); await qc.invalidateQueries({ predicate: (x) => ['/api/website/overview', '/api/website/revisions', '/api/website/translations'].some((k) => String(x.queryKey[0] ?? '').startsWith(k)) }); };
  const dirty = !stableEqual(value, s.draft[part]);
  const check = SITE_PARTS[part].safeParse(value);
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await patch(`/api/website/site/${part}`, { value, version: s.version }); await refetch(); setMsg({ kind: 'success', text: L('Draft saved. Publish site settings to make it live.', 'مسودہ محفوظ ہو گیا۔') }); }
    catch (e) { setMsg({ kind: 'error', text: errorMessage(e, L('Could not save')) }); } finally { setBusy(false); }
  };
  const languages = s.draft.languages.enabled; const defaultLang = s.draft.languages.default;
  const editLang = languages.includes(lang) ? lang : defaultLang;
  return (
    <EditLang.Provider value={{ lang: editLang, defaultLang }}>
      <PageHeader title={title} subtitle={subtitle} actions={<>{localized && <LangTabs languages={languages} value={editLang} onChange={setLang} defaultLang={defaultLang} />}<Button loading={busy} disabled={!dirty || !check.success} onClick={() => void save()}>{L('Save draft', 'مسودہ محفوظ کریں')}</Button></>} />
      <SitePublishBar site={s} onChanged={refetch} />
      {msg && <div className="mb-4"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
      {!check.success && dirty && <div className="mb-4"><Alert kind="warning">{check.error.issues[0]?.message} ({check.error.issues[0]?.path.join(' › ')})</Alert></div>}
      {children(value, (v) => setValue(v), s)}
    </EditLang.Provider>
  );
}

const navChild: Field[] = [{ k: 'label', label: 'Label', type: 'l10n', max: 60 }, { k: 'href', label: 'Goes to', type: 'text', ltr: true, placeholder: '/admissions', hint: 'A page path such as /admissions, or a full https:// link' }];
const blankLink = () => ({ label: {}, href: '/' });

export function NavigationPage() {
  const L = useL();
  return (
    <PartEditor part="navigation" title={L('Header & navigation', 'ہیڈر اور نیویگیشن')} subtitle={L('Menu items and the button in the website header. Links to pages that are not published are hidden automatically.')}>
      {(v, set) => (
        <Card><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[
          { k: 'items', label: 'Menu', type: 'list', addLabel: 'Add menu item', max: 10, titleKey: 'label', blank: () => ({ ...blankLink(), children: [] }), fields: [...navChild, { k: 'children', label: 'Dropdown links', type: 'list', addLabel: 'Add dropdown link', max: 12, titleKey: 'label', blank: blankLink, fields: navChild }] },
          { k: 'cta', label: 'Header button (e.g. Apply now)', type: 'link' },
          { k: 'showLanguageSwitcher', label: 'Show the language switcher', type: 'bool' },
          { k: 'showStaffLogin', label: 'Show "Staff sign in" in the footer', type: 'bool' }
        ]} /></Card>
      )}
    </PartEditor>
  );
}

export function FooterPage() {
  const L = useL();
  return (
    <PartEditor part="footer" title={L('Footer', 'فوٹر')} subtitle={L('Link columns, policy links and the copyright line. Contact details come from Contact information.')}>
      {(v, set) => (
        <Card><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[
          { k: 'about', label: 'Short text under the school name', type: 'l10n', multiline: true, max: 600 },
          { k: 'columns', label: 'Link columns', type: 'list', addLabel: 'Add column', max: 4, titleKey: 'title', blank: () => ({ title: {}, links: [] }), fields: [{ k: 'title', label: 'Column title', type: 'l10n', max: 60 }, { k: 'links', label: 'Links', type: 'list', addLabel: 'Add link', max: 12, titleKey: 'label', blank: blankLink, fields: navChild }] },
          { k: 'policyLinks', label: 'Policy links', type: 'list', addLabel: 'Add policy link', max: 6, titleKey: 'label', blank: blankLink, fields: navChild },
          { k: 'copyright', label: 'Copyright line (after "© year, school name")', type: 'l10n', max: 200 },
          { k: 'showSocial', label: 'Show social media icons', type: 'bool' }
        ]} /></Card>
      )}
    </PartEditor>
  );
}

export function ContactPage({ after }: { after?: ReactNode }) {
  const L = useL();
  const phones = (list: string[]) => list.map((p, i) => ({ id: `p${i}`, value: p }));
  return (
    <>
      <PartEditor part="contact" title={L('Contact information', 'رابطے کی معلومات')} subtitle={L('Shown in the footer and in Contact sections.')}>
        {(v, set) => (
          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Card title={L('School office')}><FormFields value={{ ...v, phoneList: phones(v.phones) }} onChange={(x) => { const { phoneList, ...rest } = x as typeof v & { phoneList: { value: string }[] }; set({ ...rest, phones: phoneList.map((p) => (p.value ?? '').trim()) } as typeof v); }} fields={[
              { k: 'address', label: 'Address', type: 'l10n', multiline: true, max: 400 },
              { k: 'phoneList', label: 'Phone numbers', type: 'list', addLabel: 'Add phone number', max: 4, titleKey: 'value', blank: () => ({ value: '' }), fields: [{ k: 'value', label: 'Phone number', type: 'text', ltr: true, max: 30, placeholder: '+92 300 1234567' }] },
              { k: 'email', label: 'Email', type: 'text', ltr: true, max: 160 },
              { k: 'officeHours', label: 'Office timings', type: 'l10n', multiline: true, max: 300 }
            ]} /></Card>
            <div className="space-y-5">
              <Card title={L('Admissions contact')}><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[{ k: 'admissionsPhone', label: 'Admissions phone', type: 'text', ltr: true, max: 30 }, { k: 'admissionsEmail', label: 'Admissions email', type: 'text', ltr: true, max: 160 }]} /></Card>
              <Card title={L('Map')}><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[{ k: 'mapEmbedUrl', label: 'Google Maps embed link', type: 'text', ltr: true, max: 1200, placeholder: 'https://www.google.com/maps/embed?pb=…', hint: 'Google Maps → Share → Embed a map → copy only the link inside src="…". Leave empty for no map.' }]} /></Card>
              <Card title={L('Social links')}><FormFields value={v.social} onChange={(x) => set({ ...v, social: x as typeof v.social })} fields={(['facebook', 'instagram', 'youtube', 'x', 'linkedin', 'whatsapp'] as const).map((k) => ({ k, label: k === 'x' ? 'X (Twitter)' : k[0]!.toUpperCase() + k.slice(1), type: 'text' as const, ltr: true, max: 300, placeholder: 'https://' }))} /></Card>
            </div>
          </div>
        )}
      </PartEditor>
      {after}
    </>
  );
}

function ThemePreview({ theme }: { theme: SiteContent['theme'] }) {
  const vars = themeCssVars(theme);
  const css = (name: string) => `rgb(${vars[name]})`;
  return (
    <div className="overflow-hidden rounded-xl border border-surface-line" style={{ background: css('--site-bg'), fontFamily: vars['--site-font-body'] }} aria-label="Theme preview">
      <div className="px-6 py-8" style={{ background: css('--site-primary'), color: css('--site-on-primary') }}>
        <p style={{ color: css('--site-accent'), letterSpacing: '0.24em', fontSize: 11, fontWeight: 600 }}>WELCOME</p>
        <p style={{ fontFamily: vars['--site-font-heading'], fontSize: 34, lineHeight: 1.1, marginTop: 8 }}>A place to learn and grow</p>
      </div>
      <div className="space-y-4 px-6 py-6" style={{ color: '#101828' }}>
        <p style={{ fontFamily: vars['--site-font-heading'], fontSize: 24 }}>Section heading</p>
        <p style={{ fontSize: 14, color: '#475467' }}>Body text looks like this. Headings and paragraphs use the fonts you choose.</p>
        <div className="flex flex-wrap gap-3">
          <span style={{ background: theme.buttonStyle === 'solid' ? css('--site-primary') : 'transparent', color: theme.buttonStyle === 'solid' ? css('--site-on-primary') : css('--site-primary'), border: `1px solid ${css('--site-primary')}`, borderRadius: vars['--site-radius'], padding: '10px 20px', fontSize: 11, letterSpacing: '0.16em', fontWeight: 600 }}>PRIMARY BUTTON</span>
          <span style={{ background: css('--site-accent'), color: css('--site-on-accent'), borderRadius: vars['--site-radius'], padding: '10px 20px', fontSize: 11, letterSpacing: '0.16em', fontWeight: 600 }}>ACCENT BUTTON</span>
        </div>
      </div>
      <div className="px-6 py-4 text-xs" style={{ background: theme.footerStyle === 'dark' ? css('--site-secondary') : '#fff', color: theme.footerStyle === 'dark' ? '#fff' : '#101828' }}>Footer</div>
    </div>
  );
}

export function ThemePage() {
  const L = useL();
  const opt = (o: Record<string, unknown>, names: Record<string, string> = {}) => Object.keys(o).map((k) => [k, names[k] ?? k.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())] as [string, string]);
  return (
    <PartEditor part="theme" localized={false} title={L('Theme & branding', 'تھیم اور برانڈنگ')} subtitle={L('Colours, typography and component styles. Options are limited to combinations that keep the design consistent and readable.')}>
      {(v, set) => {
        const low = contrastRatio(v.primary, '#ffffff') < 3 && contrastRatio(v.primary, '#111827') < 3;
        return (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="space-y-5">
              <Card title={L('Design presets')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(THEME_PRESETS).map(([key, p]) => { const { name, ...tokens } = p; return (
                    <button key={key} type="button" onClick={() => set({ ...v, ...tokens, preset: key })} aria-pressed={v.preset === key} className={clsx('flex items-center gap-3 rounded-xl border p-3 text-start transition hover:shadow-card', v.preset === key ? 'border-brand ring-2 ring-brand/20' : 'border-surface-line')}>
                      <span className="flex shrink-0 overflow-hidden rounded-lg border border-surface-line">{[p.primary, p.secondary, p.accent, THEME_BACKGROUNDS[p.background]].map((c) => <span key={c} className="h-10 w-5" style={{ background: c }} />)}</span>
                      <span><span className="block text-sm font-semibold">{name}</span><span className="block text-xs text-ink-soft">{p.headingFont.replace('-', ' ')}</span></span>
                    </button>
                  ); })}
                </div>
                <p className="mt-3 text-xs text-ink-faint">{L('A preset fills in every option below; you can then adjust the brand colours.')}</p>
              </Card>
              <Card title={L('Brand colours')}>
                <div className="grid gap-4 sm:grid-cols-3"><FormFields value={v} onChange={(x) => set({ ...(x as typeof v), preset: 'custom' })} fields={[{ k: 'primary', label: 'Primary', type: 'color' }]} /><FormFields value={v} onChange={(x) => set({ ...(x as typeof v), preset: 'custom' })} fields={[{ k: 'secondary', label: 'Secondary (dark areas)', type: 'color' }]} /><FormFields value={v} onChange={(x) => set({ ...(x as typeof v), preset: 'custom' })} fields={[{ k: 'accent', label: 'Accent', type: 'color' }]} /></div>
                {low && <div className="mt-4"><Alert kind="warning">{L('This primary colour gives poor contrast with both light and dark text. Choose a darker or lighter shade.')}</Alert></div>}
              </Card>
              <Card title={L('Typography & components')}>
                <div className="grid gap-4 sm:grid-cols-2"><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[
                  { k: 'headingFont', label: 'Heading font', type: 'select', options: opt(HEADING_FONTS) }, { k: 'bodyFont', label: 'Body font', type: 'select', options: opt(BODY_FONTS) }
                ]} /><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[
                  { k: 'background', label: 'Page background', type: 'select', options: opt(THEME_BACKGROUNDS) }, { k: 'radius', label: 'Corners', type: 'select', options: [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Rounded']] }
                ]} /><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[
                  { k: 'buttonStyle', label: 'Buttons', type: 'select', options: [['solid', 'Solid'], ['outline', 'Outline']] }, { k: 'headerStyle', label: 'Header', type: 'select', options: [['overlay', 'Transparent over the hero'], ['solid', 'Always solid']] }
                ]} /><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[{ k: 'footerStyle', label: 'Footer', type: 'select', options: [['dark', 'Dark'], ['light', 'Light']] }]} /></div>
                <p className="mt-3 text-xs text-ink-faint">{L('Fonts use high-quality typefaces already installed on visitors’ devices, so pages load fast and work offline. Urdu always uses a Nastaliq typeface.')}</p>
              </Card>
              <Card title={L('Logo & favicon')}><p className="text-sm text-ink-soft">{L('The website uses the school logo and favicon from')} <a className="font-medium text-brand underline" href="/admin/settings">{L('Settings → School profile')}</a>.</p></Card>
            </div>
            <div className="lg:sticky lg:top-24 lg:self-start"><ThemePreview theme={v} /></div>
          </div>
        );
      }}
    </PartEditor>
  );
}

export function SeoPage({ after }: { after?: ReactNode }) {
  const L = useL();
  return (
    <>
      <PartEditor part="seo" title={L('SEO management', 'SEO')} subtitle={L('Site-wide defaults. Each page has its own SEO title, description and sharing image in the page builder (Page & SEO).')}>
        {(v, set, site) => (
          <div className="grid gap-5 lg:grid-cols-2 [&>*]:min-w-0">
            <Card title={L('Defaults')}><FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[
              { k: 'siteTitle', label: 'Site title', type: 'l10n', max: 120, hint: 'Appears after each page title in browser tabs and search results.' },
              { k: 'description', label: 'Default description', type: 'l10n', multiline: true, max: 320 },
              { k: 'ogImage', label: 'Default social sharing image', type: 'media', kind: 'image', hint: 'Recommended 1200 × 630.' }
            ]} /></Card>
            <Card title={L('Search engines')}>
              <FormFields value={v} onChange={(x) => set(x as typeof v)} fields={[
                { k: 'allowIndexing', label: 'Allow search engines to index the website', type: 'bool' },
                { k: 'structuredData', label: 'Add structured data (school name, address, phone from Contact information)', type: 'bool' }
              ]} />
              <dl className="mt-5 space-y-2 text-sm">
                <div><dt className="text-ink-soft">{L('Canonical address')}</dt><dd dir="ltr" className="font-medium">{site.canonicalBase}/site</dd></div>
                <div><dt className="text-ink-soft">Sitemap</dt><dd dir="ltr"><a className="text-brand underline" href="/sitemap.xml" target="_blank" rel="noreferrer">{site.canonicalBase}/sitemap.xml</a></dd></div>
                <div><dt className="text-ink-soft">Robots</dt><dd dir="ltr"><a className="text-brand underline" href="/robots.txt" target="_blank" rel="noreferrer">{site.canonicalBase}/robots.txt</a></dd></div>
              </dl>
              <p className="mt-4 text-xs text-ink-faint">{L('Structured data only contains what you entered. No ratings, reviews or other claims are generated.')}</p>
            </Card>
          </div>
        )}
      </PartEditor>
      {after}
    </>
  );
}

export function LanguagesPage({ after }: { after?: ReactNode }) {
  const L = useL();
  return (
    <>
      <PartEditor part="languages" localized={false} title={L('Language & translation', 'زبان اور ترجمہ')} subtitle={L('Each language has its own addresses (for example /site/ur/admissions). Right-to-left languages get a mirrored layout.')}>
        {(v, set) => (
          <Card title={L('Website languages')}>
            <div className="space-y-3">
              {WEBSITE_LANGUAGES.map((l) => (
                <div key={l} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-line px-4 py-3">
                  <Checkbox label={<span className="font-medium">{WEBSITE_LANGUAGE_NAMES[l]} <span className="text-xs font-normal text-ink-faint">({l})</span></span>} checked={v.enabled.includes(l)} disabled={v.default === l} onChange={(on) => set({ ...v, enabled: on ? [...v.enabled, l] : v.enabled.filter((x) => x !== l) })} />
                  {v.default === l ? <Badge color="green">{L('Default language')}</Badge> : v.enabled.includes(l) && <Button variant="ghost" onClick={() => set({ ...v, default: l })}>{L('Make default')}</Button>}
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-faint">{L('Where a translation is missing, visitors see the default-language text rather than an empty space. The report below lists what still needs translating.')}</p>
          </Card>
        )}
      </PartEditor>
      {after}
    </>
  );
}

export { newId };
