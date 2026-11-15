import type { L10n } from './website.js';
import { hexToRgb } from './website.js';

/**
 * Starter website for a school that has not built one yet. Pure data: the server validates it with
 * the same schemas as any editor input before storing it.
 *
 * Nothing here states a fact about the school. The published home page is built ONLY from the
 * school's own profile (name, description, existing website text, contact details). Inner pages are
 * created as DRAFTS with clearly marked sample text for the school to replace before publishing.
 */
export interface DefaultsInput {
  name: string; description?: string | null; address?: string | null; phone?: string | null; email?: string | null;
  primaryColor?: string | null; accentColor?: string | null; defaultLanguage?: string | null;
  heroTitle?: string | null; heroSubtitle?: string | null; about?: string | null;
  showContact?: boolean; showAnnouncements?: boolean;
}
export interface DefaultPage { slug: string; systemKey: string; order: number; publish: boolean; draft: Record<string, unknown>; published: Record<string, unknown> | null }

const L = (en: string, ur?: string): L10n => (ur ? { en, ur } : { en });
const one = (s?: string | null): L10n => (s && s.trim() ? { en: s.trim() } : {});
export const SAMPLE_NOTE = 'Sample text — replace it in Website Management before publishing.';
const sample = (text: string): L10n => ({ en: `${text}\n\n(${SAMPLE_NOTE})` });

/** Darkens a hex colour towards black (used to derive the secondary brand colour). */
export function shade(hex: string, amount = 0.45): string {
  return '#' + hexToRgb(hex).map((c) => Math.round(c * (1 - amount)).toString(16).padStart(2, '0')).join('');
}

type Sec = { id: string; type: string; content: Record<string, unknown>; background?: string; spacing?: string; visible?: boolean; anchor?: string; sample?: boolean };
const link = (en: string, ur: string, href: string) => ({ label: L(en, ur), href });

function page(slug: string, order: number, title: L10n, sections: Sec[], publish = false): DefaultPage {
  const number = (list: Sec[]) => list.map(({ sample: _s, ...s }, i) => ({ ...s, id: s.id || `${s.type}-${i + 1}` }));
  const draft = { title, sections: number(sections), seo: {} };
  const published = publish ? { title, sections: number(sections.filter((s) => !s.sample)), seo: {} } : null;
  return { slug, systemKey: slug, order, publish, draft, published };
}
const header = (eyebrow: L10n, heading: L10n, intro: L10n = {}): Sec => ({ id: 'header', type: 'pageHeader', content: { eyebrow, heading, intro } });
const coll = (itemType: string, heading: L10n, opts: Record<string, unknown> = {}, extra: Partial<Sec> = {}): Sec => ({ id: '', type: 'collection', content: { itemType, heading, ...opts }, ...extra });

export function defaultPages(s: DefaultsInput): DefaultPage[] {
  const school = L(s.name);
  const pages: DefaultPage[] = [];
  let order = 0;
  const add = (slug: string, title: L10n, sections: Sec[], publish = false) => pages.push(page(slug, order++, title, sections, publish));

  add('home', L('Home', 'سرورق'), [
    { id: 'hero', type: 'hero', content: { height: 'full', slides: [{
      id: 'welcome', eyebrow: L('Welcome to', 'خوش آمدید'), headline: s.heroTitle?.trim() ? one(s.heroTitle) : school,
      description: one(s.heroSubtitle || s.description), cta1: link('Admissions', 'داخلہ', '/admissions'), cta2: link('Discover our school', 'ہمارا اسکول', '/about-us')
    }] } },
    ...(s.about?.trim() ? [{ id: 'about', type: 'textImage', content: { eyebrow: L('About us', 'ہمارے بارے میں'), heading: school, body: one(s.about), cta: link('Read more', 'مزید پڑھیں', '/about-us') } } as Sec] : []),
    { id: 'principal', type: 'textImage', sample: true, background: 'muted', content: {
      eyebrow: L("Principal's welcome", 'پرنسپل کا پیغام'), heading: L('A word from our Principal', 'پرنسپل کی جانب سے'),
      body: sample('Use this space for a short, personal welcome from the Principal: what the school stands for, how students are known and supported, and what families can expect.'),
      personName: L('Principal’s name'), personTitle: L('Principal', 'پرنسپل'), imagePosition: 'start', cta: link('Read the full message', 'مکمل پیغام', '/principals-message')
    } },
    { id: 'glance', type: 'stats', sample: true, background: 'brand', content: { heading: L('Our school at a glance', 'اسکول ایک نظر میں'), items: [
      { id: 'students', label: L('Students', 'طلبہ'), source: 'students' }, { id: 'teachers', label: L('Teachers', 'اساتذہ'), source: 'teachers' }, { id: 'classes', label: L('Classes', 'جماعتیں'), source: 'classes' }
    ] } },
    coll('program', L('Academic excellence', 'تعلیمی معیار'), { eyebrow: L('Academics', 'تعلیم'), limit: 3, viewAll: link('Explore academics', 'تعلیم دیکھیں', '/academics') }),
    coll('facility', L('Campus & facilities', 'کیمپس اور سہولیات'), { eyebrow: L('Our campus', 'ہمارا کیمپس'), limit: 6, viewAll: link('Tour the campus', 'کیمپس دیکھیں', '/campus-facilities') }, { background: 'muted' }),
    coll('activity', L('Student life', 'طلبہ کی زندگی'), { eyebrow: L('Beyond the classroom', 'کلاس روم سے آگے'), limit: 4, viewAll: link('Discover student life', 'مزید دیکھیں', '/student-life') }),
    { id: 'admissions', type: 'steps', sample: true, background: 'muted', content: { eyebrow: L('Admissions', 'داخلہ'), heading: L('Joining our school', 'داخلے کا طریقہ'), items: [
      { id: 'a', title: L('Enquire', 'معلومات'), body: sample('Describe how families first get in touch.') },
      { id: 'b', title: L('Visit & apply', 'دورہ اور درخواست'), body: sample('Describe the visit and the application form.') },
      { id: 'c', title: L('Welcome', 'خوش آمدید'), body: sample('Describe what happens after an offer is made.') }
    ] } },
    coll('faculty', L('Leadership', 'قیادت'), { eyebrow: L('Our people', 'ہماری ٹیم'), group: 'leadership', limit: 4, viewAll: link('Meet our leadership', 'قیادت سے ملیں', '/leadership') }),
    coll('achievement', L('Achievements & recognition', 'کامیابیاں'), { limit: 3, viewAll: link('All achievements', 'تمام کامیابیاں', '/achievements') }, { background: 'muted' }),
    coll('testimonial', L('What families say', 'والدین کی رائے'), { layout: 'carousel', limit: 6 }, { background: 'dark' }),
    ...(s.showAnnouncements === false ? [] : [{ id: 'announcements', type: 'announcements', content: { eyebrow: L('Notice board', 'نوٹس بورڈ'), heading: L('Latest announcements', 'تازہ ترین اعلانات'), limit: 4 } } as Sec]),
    coll('news', L('News', 'خبریں'), { eyebrow: L('Latest', 'تازہ ترین'), limit: 3, viewAll: link('All news', 'تمام خبریں', '/news') }),
    coll('event', L('Upcoming events', 'آنے والی تقریبات'), { layout: 'list', limit: 3, viewAll: link('All events', 'تمام تقریبات', '/events') }, { background: 'muted' }),
    coll('album', L('Gallery', 'گیلری'), { limit: 4, viewAll: link('Open the gallery', 'گیلری دیکھیں', '/gallery') }),
    coll('faq', L('Frequently asked questions', 'عمومی سوالات'), { limit: 5, viewAll: link('All questions', 'تمام سوالات', '/faqs') }, { background: 'muted' }),
    { id: 'cta', type: 'cta', sample: true, background: 'brand', content: { heading: L('Begin your journey with us', 'ہمارے ساتھ سفر کا آغاز کریں'), intro: sample('A short invitation to visit the school or start an application.'), cta1: link('Apply now', 'درخواست دیں', '/admissions'), cta2: link('Contact us', 'رابطہ کریں', '/contact-us') } },
    ...(s.showContact === false ? [] : [{ id: 'contact', type: 'contact', content: { eyebrow: L('Get in touch', 'رابطہ'), heading: L('Contact us', 'رابطہ کریں'), showForm: false } } as Sec])
  ], true);

  add('about-us', L('About Us', 'ہمارے بارے میں'), [
    header(L('About', 'تعارف'), L('About our school', 'ہمارے اسکول کے بارے میں')),
    { id: '', type: 'textImage', content: { heading: L('Who we are', 'ہم کون ہیں'), body: s.about?.trim() ? one(s.about) : sample('Introduce the school: who it serves, what it values and what makes its community distinctive.') } },
    { id: '', type: 'featureGrid', background: 'muted', content: { eyebrow: L('Our values', 'ہماری اقدار'), heading: L('What guides us', 'ہماری رہنمائی'), items: [
      { id: 'a', icon: 'compass', title: L('Value one'), body: sample('Describe a value the school lives by.') },
      { id: 'b', icon: 'heart', title: L('Value two'), body: sample('Describe a value the school lives by.') },
      { id: 'c', icon: 'star', title: L('Value three'), body: sample('Describe a value the school lives by.') }
    ] } }
  ]);
  add('our-history', L('Our History', 'ہماری تاریخ'), [header(L('About', 'تعارف'), L('Our history', 'ہماری تاریخ')), { id: '', type: 'richText', content: { body: sample('Tell the story of the school: how it began and the milestones along the way.') } }]);
  add('mission-vision', L('Mission & Vision', 'مشن اور وژن'), [header(L('About', 'تعارف'), L('Mission and vision', 'مشن اور وژن')), { id: '', type: 'featureGrid', content: { columns: 2, style: 'minimal', items: [
    { id: 'mission', icon: 'compass', title: L('Our mission', 'ہمارا مشن'), body: sample('State the school’s mission.') },
    { id: 'vision', icon: 'globe', title: L('Our vision', 'ہمارا وژن'), body: sample('State the school’s vision.') }
  ] } }]);
  add('leadership', L('Leadership', 'قیادت'), [header(L('About', 'تعارف'), L('Leadership', 'قیادت')), coll('faculty', L('Academic leadership', 'تعلیمی قیادت'), { group: 'leadership', limit: 24 }), coll('faculty', L('Management', 'انتظامیہ'), { group: 'management', limit: 24 }, { background: 'muted' })]);
  add('principals-message', L("Principal's Message", 'پرنسپل کا پیغام'), [header(L('About', 'تعارف'), L("Principal's message", 'پرنسپل کا پیغام')), { id: '', type: 'textImage', content: { body: sample('The Principal’s full message to students and families.'), personName: L('Principal’s name'), personTitle: L('Principal', 'پرنسپل'), imagePosition: 'start' } }]);

  add('academics', L('Academics', 'تعلیم'), [
    header(L('Academics', 'تعلیم'), L('Academic life', 'تعلیمی زندگی')),
    { id: '', type: 'textImage', content: { heading: L('Our approach to learning', 'ہمارا طریقۂ تعلیم'), body: sample('Explain the school’s academic philosophy and how teaching and learning are organised.') } },
    coll('program', L('Programmes', 'پروگرام'), { limit: 12, viewAll: link('All programmes', 'تمام پروگرام', '/programs') }, { background: 'muted' })
  ]);
  add('curriculum', L('Curriculum', 'نصاب'), [header(L('Academics', 'تعلیم'), L('Curriculum', 'نصاب')), { id: '', type: 'richText', content: { body: sample('Describe the curriculum followed, the subjects offered at each stage and how progress is assessed.') } }]);
  add('programs', L('Programs', 'پروگرام'), [header(L('Academics', 'تعلیم'), L('Our programmes', 'ہمارے پروگرام')), coll('program', {}, { limit: 24 })]);
  add('admissions', L('Admissions', 'داخلہ'), [
    header(L('Admissions', 'داخلہ'), L('Admissions', 'داخلہ')),
    { id: '', type: 'textImage', content: { heading: L('Welcome to admissions', 'داخلے میں خوش آمدید'), body: sample('Give an overview of admissions: which classes are open and when families should apply.'), cta: link('See the admission process', 'داخلے کا طریقہ', '/admission-process') } },
    { id: '', type: 'richText', background: 'muted', content: { heading: L('Eligibility and required documents', 'اہلیت اور مطلوبہ دستاویزات'), body: sample('List the eligibility requirements and the documents families need to provide.') } },
    coll('faq', L('Admission questions', 'داخلے سے متعلق سوالات'), { group: 'admissions', limit: 12 }),
    { id: 'inquiry', type: 'contact', background: 'muted', anchor: 'inquiry', content: { eyebrow: L('Enquiries', 'معلومات'), heading: L('Admission inquiry', 'داخلے کی معلومات'), formType: 'admission', showMap: false } }
  ]);
  add('admission-process', L('Admission Process', 'داخلے کا طریقہ'), [header(L('Admissions', 'داخلہ'), L('Admission process', 'داخلے کا طریقہ')), { id: '', type: 'steps', content: { items: [
    { id: 'a', title: L('Step one'), body: sample('Describe the first step.') }, { id: 'b', title: L('Step two'), body: sample('Describe the second step.') }, { id: 'c', title: L('Step three'), body: sample('Describe the third step.') }
  ] } }]);
  add('faculty', L('Faculty', 'اساتذہ'), [header(L('Our people', 'ہماری ٹیم'), L('Faculty', 'اساتذہ')), coll('faculty', {}, { limit: 48 })]);
  add('campus-facilities', L('Campus & Facilities', 'کیمپس اور سہولیات'), [header(L('Our campus', 'ہمارا کیمپس'), L('Campus and facilities', 'کیمپس اور سہولیات')), coll('facility', {}, { limit: 24 })]);
  add('student-life', L('Student Life', 'طلبہ کی زندگی'), [
    header(L('Student life', 'طلبہ کی زندگی'), L('Life at our school', 'اسکول کی زندگی')),
    { id: '', type: 'textImage', content: { body: sample('Describe daily life beyond lessons: clubs, sports, trips and cultural events.') } },
    coll('activity', L('Activities', 'سرگرمیاں'), { limit: 8, viewAll: link('All activities and clubs', 'تمام سرگرمیاں', '/activities-clubs') }, { background: 'muted' })
  ]);
  add('activities-clubs', L('Activities & Clubs', 'سرگرمیاں اور کلب'), [header(L('Student life', 'طلبہ کی زندگی'), L('Activities and clubs', 'سرگرمیاں اور کلب')), coll('activity', {}, { limit: 48 })]);
  add('achievements', L('Achievements', 'کامیابیاں'), [header(L('Recognition', 'اعزازات'), L('Achievements', 'کامیابیاں')), coll('achievement', {}, { limit: 48 })]);
  add('news', L('News', 'خبریں'), [
    header(L('Latest', 'تازہ ترین'), L('News and announcements', 'خبریں اور اعلانات')),
    ...(s.showAnnouncements === false ? [] : [{ id: 'announcements', type: 'announcements', content: { heading: L('Announcements', 'اعلانات'), limit: 20 } } as Sec]),
    coll('news', L('News', 'خبریں'), { limit: 24 })
  ], true);
  add('events', L('Events', 'تقریبات'), [header(L('Calendar', 'کیلنڈر'), L('Events', 'تقریبات')), coll('event', {}, { limit: 24, layout: 'list' })]);
  add('gallery', L('Gallery', 'گیلری'), [header(L('Gallery', 'گیلری'), L('Gallery', 'گیلری')), coll('album', {}, { limit: 48 })]);
  add('faqs', L('FAQs', 'عمومی سوالات'), [header(L('Help', 'مدد'), L('Frequently asked questions', 'عمومی سوالات')), coll('faq', {}, { limit: 48 })]);
  add('contact-us', L('Contact Us', 'رابطہ کریں'), [header(L('Get in touch', 'رابطہ'), L('Contact us', 'رابطہ کریں')), { id: 'contact', type: 'contact', content: {} }], s.showContact !== false);
  add('privacy-policy', L('Privacy Policy', 'رازداری کی پالیسی'), [header({}, L('Privacy policy', 'رازداری کی پالیسی')), { id: '', type: 'richText', content: { body: sample('Publish the school’s privacy policy here.') } }]);
  add('terms-conditions', L('Terms & Conditions', 'شرائط و ضوابط'), [header({}, L('Terms and conditions', 'شرائط و ضوابط')), { id: '', type: 'richText', content: { body: sample('Publish the terms for using this website here.') } }]);
  return pages;
}

export function defaultSiteContent(s: DefaultsInput): Record<string, unknown> {
  const hex = (v: string | null | undefined, d: string) => (v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : d);
  const primary = hex(s.primaryColor, '#1e3a5f');
  const item = (id: string, en: string, ur: string, href: string, children: [string, string, string][] = []) => ({ id, label: L(en, ur), href, children: children.map(([e, u, h], i) => ({ id: `${id}-${i + 1}`, label: L(e, u), href: h })) });
  const phoneOk = s.phone && /^\+?[0-9()\- ]{5,30}$/.test(s.phone.trim());
  const emailOk = s.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email.trim());
  return {
    navigation: {
      items: [
        item('about', 'About Us', 'تعارف', '/about-us', [['Our History', 'ہماری تاریخ', '/our-history'], ['Mission & Vision', 'مشن اور وژن', '/mission-vision'], ['Leadership', 'قیادت', '/leadership'], ["Principal's Message", 'پرنسپل کا پیغام', '/principals-message']]),
        item('academics', 'Academics', 'تعلیم', '/academics', [['Curriculum', 'نصاب', '/curriculum'], ['Programs', 'پروگرام', '/programs'], ['Faculty', 'اساتذہ', '/faculty']]),
        item('admissions', 'Admissions', 'داخلہ', '/admissions', [['Admission Process', 'داخلے کا طریقہ', '/admission-process'], ['FAQs', 'عمومی سوالات', '/faqs']]),
        item('student-life', 'Student Life', 'طلبہ کی زندگی', '/student-life', [['Activities & Clubs', 'سرگرمیاں اور کلب', '/activities-clubs'], ['Achievements', 'کامیابیاں', '/achievements']]),
        item('campus', 'Campus & Facilities', 'کیمپس', '/campus-facilities', [['Gallery', 'گیلری', '/gallery']]),
        item('news', 'News & Events', 'خبریں اور تقریبات', '/news', [['Events', 'تقریبات', '/events']]),
        item('contact', 'Contact', 'رابطہ', '/contact-us')
      ],
      cta: link('Apply now', 'درخواست دیں', '/admissions'), showLanguageSwitcher: true, showStaffLogin: true
    },
    footer: {
      about: one(s.description),
      columns: [
        { id: 'explore', title: L('Explore', 'دریافت کریں'), links: [['About Us', 'تعارف', '/about-us'], ['Academics', 'تعلیم', '/academics'], ['Admissions', 'داخلہ', '/admissions'], ['Student Life', 'طلبہ کی زندگی', '/student-life']].map(([e, u, h], i) => ({ id: `e${i}`, label: L(e!, u), href: h! })) },
        { id: 'community', title: L('Community', 'کمیونٹی'), links: [['News', 'خبریں', '/news'], ['Events', 'تقریبات', '/events'], ['Gallery', 'گیلری', '/gallery'], ['FAQs', 'عمومی سوالات', '/faqs']].map(([e, u, h], i) => ({ id: `c${i}`, label: L(e!, u), href: h! })) }
      ],
      policyLinks: [{ id: 'privacy', label: L('Privacy Policy', 'رازداری کی پالیسی'), href: '/privacy-policy' }, { id: 'terms', label: L('Terms & Conditions', 'شرائط و ضوابط'), href: '/terms-conditions' }],
      copyright: L('All rights reserved.', 'جملہ حقوق محفوظ ہیں۔'), showSocial: true
    },
    contact: { address: one(s.address), phones: phoneOk ? [s.phone!.trim()] : [], email: emailOk ? s.email!.trim() : '' },
    theme: { preset: 'school', primary, secondary: shade(primary), accent: hex(s.accentColor, '#c8963e') },
    seo: { siteTitle: L(s.name), description: one(s.description) },
    languages: { enabled: ['en', 'ur'], default: s.defaultLanguage === 'ur' ? 'ur' : 'en' }
  };
}
