import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import clsx from 'clsx';
import { useL } from './api';
import Builder from './Builder';
import { MediaLibrary } from './MediaLibrary';
import { CollectionManager } from './Collections';
import { ContactPage, FooterPage, LanguagesPage, NavigationPage, SeoPage, ThemePage } from './SiteParts';
import { Hub, Inquiries, NewsEventsPage, OverviewPage, PageLinks, PagesPage, PublishingPage, RevisionsPage, SettingsPage, TranslationReport } from './Screens';
import { PageHeader } from '../../components/ui';

/**
 * Website Management: the CMS for the public school website, inside the existing Admin Dashboard
 * (same layout, session, permissions). Route: /admin/website/*
 */
const NAV: { group: string; ur: string; items: { to: string; en: string; ur?: string }[] }[] = [
  { group: 'Website', ur: 'ویب سائٹ', items: [
    { to: '', en: 'Website overview', ur: 'جائزہ' }, { to: 'builder', en: 'Page builder', ur: 'پیج بلڈر' }, { to: 'pages', en: 'Pages', ur: 'صفحات' },
    { to: 'navigation', en: 'Header & navigation', ur: 'ہیڈر اور نیویگیشن' }, { to: 'hero', en: 'Hero & banners', ur: 'ہیرو اور بینر' }, { to: 'sections', en: 'Sections', ur: 'حصے' }, { to: 'media', en: 'Media library', ur: 'میڈیا لائبریری' }
  ] },
  { group: 'Content', ur: 'مواد', items: [
    { to: 'about', en: 'About & leadership', ur: 'تعارف اور قیادت' }, { to: 'academics', en: 'Academics', ur: 'تعلیم' }, { to: 'admissions', en: 'Admissions', ur: 'داخلہ' }, { to: 'faculty', en: 'Faculty', ur: 'اساتذہ' },
    { to: 'campus', en: 'Campus & facilities', ur: 'کیمپس' }, { to: 'student-life', en: 'Student life', ur: 'طلبہ کی زندگی' }, { to: 'news', en: 'News & events', ur: 'خبریں اور تقریبات' }, { to: 'gallery', en: 'Gallery', ur: 'گیلری' },
    { to: 'testimonials', en: 'Testimonials', ur: 'آراء' }, { to: 'faqs', en: 'FAQs', ur: 'عمومی سوالات' }, { to: 'contact', en: 'Contact information', ur: 'رابطہ' }, { to: 'footer', en: 'Footer', ur: 'فوٹر' }
  ] },
  { group: 'Design & publishing', ur: 'ڈیزائن اور اشاعت', items: [
    { to: 'theme', en: 'Theme & branding', ur: 'تھیم' }, { to: 'languages', en: 'Language & translation', ur: 'زبان' }, { to: 'seo', en: 'SEO management', ur: 'SEO' },
    { to: 'publishing', en: 'Domain & publishing', ur: 'ڈومین اور اشاعت' }, { to: 'revisions', en: 'Revision history', ur: 'ترمیمی تاریخ' }, { to: 'settings', en: 'Website settings', ur: 'ترتیبات' }
  ] }
];

function SubNav() {
  const L = useL();
  return (
    <nav aria-label={L('Website Management', 'ویب سائٹ مینجمنٹ')} className="card mb-6 p-3">
      <div className="grid gap-x-6 gap-y-3 lg:grid-cols-3">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{L(g.group, g.ur)}</p>
            <div className="flex flex-wrap gap-1">
              {g.items.map((i) => (
                <NavLink key={i.to} to={`/admin/website${i.to ? `/${i.to}` : ''}`} end={i.to === ''} className={({ isActive }) => clsx('rounded-lg px-2.5 py-1.5 text-sm transition', isActive ? 'bg-brand font-medium text-white' : 'text-ink-soft hover:bg-surface-muted hover:text-ink')}>{L(i.en, i.ur)}</NavLink>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

export default function WebsiteManagement() {
  const L = useL();
  return (
    <div>
      <SubNav />
      <Routes>
        <Route index element={<OverviewPage />} />
        <Route path="builder" element={<Builder fixedSlug="home" key="home" />} />
        <Route path="builder/:id" element={<BuilderById />} />
        <Route path="pages" element={<PagesPage />} />
        <Route path="navigation" element={<NavigationPage />} />
        <Route path="hero" element={<Builder fixedSlug="home" only="hero" key="hero" />} />
        <Route path="sections" element={<div className="space-y-5"><PageHeader title={L('Sections', 'حصے')} subtitle={L('Every page is made of sections. Choose a page to add, reorder, hide or edit its sections.')} /><PageLinks slugs={['home', 'about-us', 'academics', 'admissions', 'student-life', 'campus-facilities', 'news', 'contact-us']} /><p className="text-sm text-ink-soft">{L('All other pages are listed under Pages.')}</p></div>} />
        <Route path="media" element={<div className="space-y-5"><PageHeader title={L('Media library', 'میڈیا لائبریری')} subtitle={L('Photos and videos for the website. Upload files, or add Cloudinary, YouTube and Vimeo links.')} /><div className="card p-5"><MediaLibrary /></div></div>} />
        <Route path="about" element={<Hub title={L('About & leadership', 'تعارف اور قیادت')} pages={['about-us', 'our-history', 'mission-vision', 'leadership', 'principals-message']} collections={[{ type: 'faculty', group: 'leadership' }, { type: 'faculty', group: 'management' }]} />} />
        <Route path="academics" element={<Hub title={L('Academics', 'تعلیم')} pages={['academics', 'curriculum', 'programs']} collections={[{ type: 'program' }]} />} />
        <Route path="admissions" element={<Hub title={L('Admissions', 'داخلہ')} subtitle={L('Admission pages, admission FAQs and the inquiries sent from the website form.')} pages={['admissions', 'admission-process']} collections={[{ type: 'faq', group: 'admissions' }]}><Inquiries kind="admission" /></Hub>} />
        <Route path="faculty" element={<Hub title={L('Faculty', 'اساتذہ')} subtitle={L('Publish only profiles of staff who have agreed to appear on the website.')} pages={['faculty', 'leadership']}><CollectionManager type="faculty" /></Hub>} />
        <Route path="campus" element={<Hub title={L('Campus & facilities', 'کیمپس اور سہولیات')} pages={['campus-facilities']} collections={[{ type: 'facility' }]} />} />
        <Route path="student-life" element={<Hub title={L('Student life', 'طلبہ کی زندگی')} pages={['student-life', 'activities-clubs', 'achievements']} collections={[{ type: 'activity' }, { type: 'achievement' }]} />} />
        <Route path="news" element={<NewsEventsPage />} />
        <Route path="gallery" element={<Hub title={L('Gallery', 'گیلری')} pages={['gallery']} collections={[{ type: 'album' }]} />} />
        <Route path="testimonials" element={<Hub title={L('Testimonials', 'آراء')} subtitle={L('A testimonial is public only after you publish it. Publish only real statements shared with permission.')} collections={[{ type: 'testimonial' }]} />} />
        <Route path="faqs" element={<Hub title={L('FAQs', 'عمومی سوالات')} pages={['faqs']} collections={[{ type: 'faq' }]} />} />
        <Route path="contact" element={<ContactPage after={<div className="mt-5 space-y-5"><PageLinks slugs={['contact-us']} /><Inquiries /></div>} />} />
        <Route path="footer" element={<FooterPage />} />
        <Route path="theme" element={<ThemePage />} />
        <Route path="languages" element={<LanguagesPage after={<div className="mt-5 space-y-5"><TranslationReport /></div>} />} />
        <Route path="seo" element={<SeoPage after={<div className="mt-5"><PageLinks slugs={['home', 'about-us', 'academics', 'admissions', 'contact-us']} /></div>} />} />
        <Route path="publishing" element={<PublishingPage />} />
        <Route path="revisions" element={<RevisionsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/admin/website" replace />} />
      </Routes>
    </div>
  );
}

// Remount the builder when another page is opened so no state leaks between pages.
import { useParams } from 'react-router-dom';
function BuilderById() { const { id } = useParams(); return <Builder key={id} />; }
