import type { L10n, MediaRef } from './website.js';
import { slugify } from './website.js';
import { defaultSiteContent, type DefaultPage } from './website-defaults.js';

/**
 * Branded showcase website for The Alpha School System — 47 Campus.
 *
 * Pure data, applied by `npm run website:alpha -w server` (validated with the same schemas as any
 * editor input). Every photo is a royalty-free stock photograph bundled with the app under
 * /site-assets/alpha/ and every figure, name, date and contact detail is DEMO content: replace them
 * in Website Management (pages, collections, media library) with the school's own.
 */
export const ALPHA_BRAND = {
  name: 'The Alpha School System — 47 Campus',
  shortName: 'Alpha School 47',
  tagline: 'Learn, Grow, Succeed',
  description: 'The Alpha School System, 47 Campus — a caring, ambitious school where every child is known, challenged and inspired to learn, grow and succeed.',
  primaryColor: '#1c1f5e', accentColor: '#29abe2',
  logoPath: '/brand/alpha-logo.png', faviconPath: '/brand/favicon.png'
} as const;

const L = (en: string, ur?: string): L10n => (ur ? { en, ur } : { en });
const img = (name: string, alt: string): MediaRef => ({ kind: 'image', provider: 'local', url: `/site-assets/alpha/${name}.jpg`, alt: { en: alt } });
const link = (en: string, ur: string, href: string) => ({ label: L(en, ur), href });

type Sec = { id: string; type: string; content: Record<string, unknown>; background?: string; spacing?: string; anchor?: string };
let auto = 0;
const sec = (type: string, content: Record<string, unknown>, extra: Partial<Sec> = {}): Sec => ({ id: extra.id ?? `${type}-${++auto}`, type, content, ...extra });
const header = (eyebrow: L10n, heading: L10n, intro: L10n, image: MediaRef): Sec => sec('pageHeader', { eyebrow, heading, intro, image }, { id: 'header' });
const coll = (itemType: string, content: Record<string, unknown>, extra: Partial<Sec> = {}): Sec => sec('collection', { itemType, ...content }, extra);

// ---------------------------------------------------------------------------- photos
const P = {
  heroClass: img('hero-classroom', 'Students at their desks during a lesson'),
  heroCampus: img('hero-campus', 'The school campus and its lawns'),
  heroYoung: img('hero-young-learners', 'Young learners gathered together in class'),
  about: img('about-students', 'Students concentrating on their written work'),
  principal: img('principal', 'Portrait of the Principal'),
  early: img('early-years', 'Early years children learning through play'),
  primary: img('primary', 'A primary pupil writing in his exercise book'),
  secondary: img('secondary', 'Secondary students studying together'),
  library: img('library', 'The bright, glass-walled library'),
  lab: img('science-lab', 'Glassware in the science laboratory'),
  computer: img('computer-lab', 'A student working on a laptop in the computer lab'),
  sports: img('sports-ground', 'Football on the sports ground'),
  classrooms: img('classrooms', 'A clean, well-lit classroom'),
  auditorium: img('auditorium', 'The auditorium during an assembly'),
  athletics: img('athletics', 'An athlete in the starting blocks on the track'),
  maths: img('maths-club', 'Equations on a whiteboard in maths club'),
  reading: img('reading-club', 'Shelves of books in the reading room'),
  arts: img('creative-arts', 'Books, crayons and an apple on a classroom table'),
  graduation: img('graduation', 'Graduates throwing their caps in celebration'),
  firstDay: img('first-day', 'A young child with a school backpack on the first day'),
  loveToLearn: img('love-to-learn', 'A "Love to Learn" pencil mural'),
  classSession: img('class-in-session', 'A class in session with students at their desks'),
  f1: img('faculty-1', 'Portrait of a senior faculty member'),
  f2: img('faculty-2', 'Portrait of a faculty member'),
  f3: img('faculty-3', 'Portrait of a faculty member'),
  f4: img('faculty-4', 'Portrait of a faculty member'),
  p1: img('parent-1', 'Portrait of a parent'),
  p2: img('parent-2', 'Portrait of a parent'),
  p3: img('parent-3', 'Portrait of an alumnus')
};

// ---------------------------------------------------------------------------- pages
export function alphaPages(): DefaultPage[] {
  auto = 0;
  const pages: DefaultPage[] = [];
  let order = 0;
  const add = (slug: string, title: L10n, sections: Sec[]) => {
    const content = { title, sections, seo: {} };
    pages.push({ slug, systemKey: slug, order: order++, publish: true, draft: content, published: content });
  };

  add('home', L('Home', 'سرورق'), [
    sec('hero', { height: 'full', slides: [
      { id: 'welcome', mediaType: 'image', desktop: P.heroClass, overlay: 50, animation: 'zoom', durationSec: 8,
        eyebrow: L('The Alpha School System · 47 Campus'), headline: L('Learn. Grow. Succeed.', 'سیکھیں۔ بڑھیں۔ کامیاب ہوں۔'),
        description: L('An ambitious, caring school where every child is known by name, challenged every day and inspired to reach further.'),
        cta1: link('Apply for admission', 'داخلہ', '/admissions'), cta2: link('Discover Alpha', 'ہمارا اسکول', '/about-us') },
      { id: 'campus', mediaType: 'image', desktop: P.heroCampus, overlay: 45, animation: 'zoom', durationSec: 8,
        eyebrow: L('A campus built for learning'), headline: L('Space to think, explore and belong'),
        description: L('Bright classrooms, science and computer labs, a modern library and open playing fields — all on one secure campus.'),
        cta1: link('Tour the campus', 'کیمپس', '/campus-facilities'), cta2: link('Contact us', 'رابطہ', '/contact-us') },
      { id: 'early', mediaType: 'image', desktop: P.heroYoung, overlay: 50, animation: 'zoom', durationSec: 8,
        eyebrow: L('Admissions open 2027–28'), headline: L('The first steps of a lifelong journey'),
        description: L('From Playgroup to Matric, our teachers build strong foundations, confident voices and a genuine love of learning.'),
        cta1: link('Admission process', 'داخلے کا طریقہ', '/admission-process'), cta2: link('Read our FAQs', 'سوالات', '/faqs') }
    ] }, { id: 'hero' }),
    sec('stats', { items: [
      { id: 'students', label: L('Students', 'طلبہ'), source: 'manual', value: 1250, suffix: '+' },
      { id: 'teachers', label: L('Qualified teachers', 'اساتذہ'), source: 'manual', value: 85, suffix: '+' },
      { id: 'results', label: L('Board pass rate', 'نتائج'), source: 'manual', value: 98, suffix: '%' },
      { id: 'clubs', label: L('Clubs & societies', 'کلب'), source: 'manual', value: 24, suffix: '' }
    ] }, { background: 'brand', spacing: 'compact', id: 'glance' }),
    sec('textImage', {
      eyebrow: L('Welcome to Alpha', 'خوش آمدید'), heading: L('A school where children are known, challenged and cared for'),
      intro: L('At 47 Campus we believe excellent schooling is personal.'),
      body: L('Small classes, devoted teachers and a rich curriculum mean every student is seen for who they are and encouraged to become who they can be.\n\nOur pupils leave Alpha as confident communicators, curious thinkers and kind young people — ready for the best colleges and for life beyond them.'),
      image: P.about, imagePosition: 'end', cta: link('More about our school', 'مزید', '/about-us')
    }, { id: 'about' }),
    sec('featureGrid', { eyebrow: L('Why Alpha', 'کیوں الفا'), heading: L('Four promises we make to every family'), columns: 4, style: 'cards', items: [
      { id: 'a', icon: 'graduation', title: L('Academic excellence'), body: L('A rigorous, well-sequenced curriculum and consistently outstanding board results.') },
      { id: 'b', icon: 'heart', title: L('Personal care'), body: L('Class teachers and counsellors who know every child and keep families closely informed.') },
      { id: 'c', icon: 'globe', title: L('Confident communicators'), body: L('Fluent English and Urdu, debate, public speaking and leadership from the early years.') },
      { id: 'd', icon: 'shield', title: L('Safe, modern campus'), body: L('Secure gates, CCTV, trained staff, digital attendance and SMS alerts for parents.') }
    ] }, { background: 'muted', id: 'why' }),
    sec('textImage', {
      eyebrow: L("Principal's welcome", 'پرنسپل کا پیغام'), heading: L('"We teach children to think for themselves — and to care for others."'),
      body: L('Welcome to The Alpha School System, 47 Campus. For us, a great education is measured not only in grades, but in character, curiosity and the confidence to lead. I warmly invite you to visit us and see our school at work.'),
      personName: L('Mrs. Sarah Ahmed'), personTitle: L('Principal, 47 Campus'), image: P.principal, imagePosition: 'start',
      cta: link('Read the full message', 'مکمل پیغام', '/principals-message')
    }, { id: 'principal' }),
    coll('program', { eyebrow: L('Academics', 'تعلیم'), heading: L('A clear path from Playgroup to Matric', 'تعلیمی مراحل'), limit: 3, viewAll: link('Explore academics', 'تعلیم', '/academics') }, { background: 'muted', id: 'programs' }),
    coll('facility', { eyebrow: L('Our campus', 'ہمارا کیمپس'), heading: L('Campus & facilities', 'کیمپس اور سہولیات'), limit: 6, viewAll: link('Tour the campus', 'کیمپس', '/campus-facilities') }, { id: 'facilities' }),
    coll('activity', { eyebrow: L('Beyond the classroom', 'کلاس روم سے آگے'), heading: L('Student life', 'طلبہ کی زندگی'), limit: 4, viewAll: link('Discover student life', 'مزید', '/student-life') }, { background: 'muted', id: 'activities' }),
    sec('steps', { eyebrow: L('Admissions', 'داخلہ'), heading: L('Joining Alpha in three simple steps', 'داخلے کا طریقہ'), items: [
      { id: 'a', title: L('Enquire & visit'), body: L('Call, message or fill in the enquiry form. We will invite you for a personal campus tour.') },
      { id: 'b', title: L('Apply & assess'), body: L('Submit the application with documents. Your child meets our team for a friendly assessment.') },
      { id: 'c', title: L('Welcome to Alpha'), body: L('Receive your offer, complete enrolment and join our orientation day before classes begin.') }
    ] }, { id: 'admissions' }),
    coll('testimonial', { eyebrow: L('In their words'), heading: L('What families say', 'والدین کی رائے'), layout: 'carousel', limit: 6 }, { background: 'dark', id: 'testimonials' }),
    coll('faculty', { eyebrow: L('Our people', 'ہماری ٹیم'), heading: L('Leadership', 'قیادت'), group: 'leadership', limit: 4, viewAll: link('Meet our faculty', 'اساتذہ', '/faculty') }, { id: 'leadership' }),
    coll('news', { eyebrow: L('Latest', 'تازہ ترین'), heading: L('News from 47 Campus', 'خبریں'), limit: 3, viewAll: link('All news', 'تمام خبریں', '/news') }, { background: 'muted', id: 'news' }),
    coll('event', { eyebrow: L('Calendar', 'کیلنڈر'), heading: L('Upcoming events', 'آنے والی تقریبات'), layout: 'list', limit: 3, viewAll: link('All events', 'تمام تقریبات', '/events') }, { id: 'events' }),
    coll('album', { eyebrow: L('Gallery', 'گیلری'), heading: L('Moments at Alpha'), limit: 3, viewAll: link('Open the gallery', 'گیلری', '/gallery') }, { background: 'muted', id: 'gallery' }),
    sec('cta', { eyebrow: L('Admissions open 2027–28'), heading: L('Begin your child’s Alpha journey', 'ہمارے ساتھ سفر کا آغاز کریں'), intro: L('Book a campus tour, meet our teachers and see why families choose The Alpha School System.'), cta1: link('Apply now', 'درخواست دیں', '/admissions'), cta2: link('Book a visit', 'رابطہ', '/contact-us'), image: P.graduation }, { id: 'cta', spacing: 'spacious' }),
    sec('contact', { eyebrow: L('Get in touch', 'رابطہ'), heading: L('Visit 47 Campus', 'رابطہ کریں'), showForm: true, showMap: false }, { id: 'contact' })
  ]);

  add('about-us', L('About Us', 'ہمارے بارے میں'), [
    header(L('About Alpha', 'تعارف'), L('Learn, grow, succeed — together'), L('A community of students, teachers and families committed to excellence and good character.'), P.heroCampus),
    sec('textImage', { eyebrow: L('Who we are'), heading: L('An Alpha education'), body: L('The Alpha School System is a network of schools dedicated to high-quality, values-based education. 47 Campus serves families from Playgroup to Matric with a modern curriculum, experienced teachers and a warm, disciplined environment.\n\nWe combine strong academics with sport, the arts, technology and community service, so that every student develops head, heart and hands.'), image: P.classSession, imagePosition: 'end' }),
    sec('featureGrid', { eyebrow: L('Our values', 'ہماری اقدار'), heading: L('What guides us'), columns: 3, style: 'cards', items: [
      { id: 'a', icon: 'compass', title: L('Integrity'), body: L('We are honest, fair and responsible in everything we do.') },
      { id: 'b', icon: 'star', title: L('Excellence'), body: L('We set high standards and support every learner to reach them.') },
      { id: 'c', icon: 'heart', title: L('Respect'), body: L('We value every person and celebrate our diverse community.') }
    ] }, { background: 'muted' }),
    sec('cta', { heading: L('See Alpha for yourself'), intro: L('The best way to know a school is to walk its corridors. We would love to show you around.'), cta1: link('Book a visit', 'رابطہ', '/contact-us'), cta2: link('Admissions', 'داخلہ', '/admissions') }, { background: 'brand' })
  ]);
  add('our-history', L('Our History', 'ہماری تاریخ'), [
    header(L('About', 'تعارف'), L('Our history', 'ہماری تاریخ'), L('From a single building to a thriving campus.'), P.heroCampus),
    sec('steps', { heading: L('Milestones'), items: [
      { id: 'a', title: L('2005 — The first classroom'), body: L('The Alpha School System opens its doors with 120 students and a mission to make excellent schooling accessible.') },
      { id: 'b', title: L('2012 — 47 Campus opens'), body: L('A purpose-built campus with science labs, a library and sports grounds welcomes its first cohort.') },
      { id: 'c', title: L('2019 — Digital learning'), body: L('Smart classrooms, a computer lab and an online parent portal bring families closer to learning.') },
      { id: 'd', title: L('Today'), body: L('More than 1,250 students and 85 teachers learn, grow and succeed together at 47 Campus.') }
    ] })
  ]);
  add('mission-vision', L('Mission & Vision', 'مشن اور وژن'), [
    header(L('About', 'تعارف'), L('Mission and vision', 'مشن اور وژن'), L('Why we exist and where we are going.'), P.loveToLearn),
    sec('featureGrid', { columns: 2, style: 'minimal', items: [
      { id: 'mission', icon: 'compass', title: L('Our mission', 'ہمارا مشن'), body: L('To provide an excellent, balanced education that develops knowledge, character and confidence, preparing every student to contribute positively to Pakistan and the world.') },
      { id: 'vision', icon: 'globe', title: L('Our vision', 'ہمارا وژن'), body: L('To be the school of choice for families who want their children to learn deeply, grow with good values and succeed in a changing world.') }
    ] })
  ]);
  add('leadership', L('Leadership', 'قیادت'), [
    header(L('About', 'تعارف'), L('Leadership', 'قیادت'), L('The team responsible for the quality of teaching, learning and care at 47 Campus.'), P.auditorium),
    coll('faculty', { heading: L('Academic leadership'), group: 'leadership', limit: 24 }),
    coll('faculty', { heading: L('Faculty'), group: 'teacher', limit: 24 }, { background: 'muted' })
  ]);
  add('principals-message', L("Principal's Message", 'پرنسپل کا پیغام'), [
    header(L('About', 'تعارف'), L("Principal's message", 'پرنسپل کا پیغام'), {}, P.classSession),
    sec('textImage', { heading: L('Dear parents and students,'), body: L('It is a privilege to lead The Alpha School System, 47 Campus. Every morning I see students arriving eager to learn, and teachers ready to give their very best.\n\nOur aim is simple: to help each child discover their strengths, work hard, and grow into a thoughtful, confident and kind young person. We hold high expectations, and we pair them with genuine care.\n\nWe work in close partnership with families. Through regular meetings, our parent portal and SMS updates, you will always know how your child is doing.\n\nI warmly invite you to visit our campus and become part of the Alpha family.'), personName: L('Mrs. Sarah Ahmed'), personTitle: L('Principal, 47 Campus'), image: P.principal, imagePosition: 'start' })
  ]);

  add('academics', L('Academics', 'تعلیم'), [
    header(L('Academics', 'تعلیم'), L('Academic life at Alpha', 'تعلیمی زندگی'), L('Strong foundations, inspiring teaching and outstanding results.'), P.classSession),
    sec('textImage', { eyebrow: L('Our approach'), heading: L('Teaching that builds understanding'), body: L('Lessons at Alpha are carefully planned, active and engaging. Teachers check understanding constantly, give clear feedback and stretch every learner.\n\nRegular assessments, parent–teacher meetings and online progress reports keep families informed at every stage.'), image: P.primary, imagePosition: 'end' }),
    coll('program', { eyebrow: L('Programmes'), heading: L('Stages of learning'), limit: 12, viewAll: link('All programmes', 'تمام پروگرام', '/programs') }, { background: 'muted' })
  ]);
  add('curriculum', L('Curriculum', 'نصاب'), [
    header(L('Academics', 'تعلیم'), L('Curriculum', 'نصاب'), L('A broad, balanced and ambitious curriculum.'), P.maths),
    sec('richText', { heading: L('What our students learn'), body: L('Our curriculum follows the national framework and the Federal / Punjab Board examinations, enriched with the Alpha programme of reading, critical thinking, computing and character education.\n\nCore subjects: English, Urdu, Mathematics, General Science (Physics, Chemistry, Biology), Islamiat, Pakistan Studies and Computer Science.\n\nEnrichment: Art, physical education, debating, Qur’an recitation, robotics and community service.') })
  ]);
  add('programs', L('Programs', 'پروگرام'), [header(L('Academics', 'تعلیم'), L('Our programmes', 'ہمارے پروگرام'), L('Playgroup to Matric on one campus.'), P.early), coll('program', { limit: 24 })]);
  add('admissions', L('Admissions', 'داخلہ'), [
    header(L('Admissions', 'داخلہ'), L('Admissions 2027–28', 'داخلہ'), L('We welcome applications for Playgroup to Grade 9.'), P.firstDay),
    sec('textImage', { eyebrow: L('Welcome'), heading: L('We look forward to meeting your family'), body: L('Admissions for the 2027–28 academic year are now open. Places are limited in each class, and we encourage families to apply early.\n\nOur admissions team will guide you through every step — from your first visit to your child’s first day.'), image: P.firstDay, imagePosition: 'start', cta: link('See the admission process', 'داخلے کا طریقہ', '/admission-process') }),
    sec('richText', { heading: L('Eligibility and documents'), body: L('Age on 31 March: Playgroup 3+, Nursery 4+, Prep 5+.\n\nRequired documents: B-Form or birth certificate, two passport-size photographs, copies of parents’ CNIC, and the previous school’s report card and leaving certificate (Grade 1 and above).') }, { background: 'muted' }),
    coll('faq', { heading: L('Admission questions'), group: 'admissions', limit: 12 }),
    sec('contact', { eyebrow: L('Enquiries'), heading: L('Admission enquiry', 'داخلے کی معلومات'), formType: 'admission', showMap: false }, { background: 'muted', anchor: 'inquiry' })
  ]);
  add('admission-process', L('Admission Process', 'داخلے کا طریقہ'), [
    header(L('Admissions', 'داخلہ'), L('Admission process', 'داخلے کا طریقہ'), L('Four clear steps from enquiry to enrolment.'), P.firstDay),
    sec('steps', { items: [
      { id: 'a', title: L('Enquiry'), body: L('Contact the admissions office or submit the online enquiry form.') },
      { id: 'b', title: L('Campus visit'), body: L('Tour the campus and meet our team with your child.') },
      { id: 'c', title: L('Assessment'), body: L('A short, age-appropriate assessment and a friendly interview.') },
      { id: 'd', title: L('Enrolment'), body: L('Accept the offer, submit documents and pay the admission fee.') }
    ] })
  ]);
  add('faculty', L('Faculty', 'اساتذہ'), [header(L('Our people', 'ہماری ٹیم'), L('Faculty', 'اساتذہ'), L('Experienced, caring and continually trained.'), P.classSession), coll('faculty', { limit: 48 })]);
  add('campus-facilities', L('Campus & Facilities', 'کیمپس اور سہولیات'), [header(L('Our campus', 'ہمارا کیمپس'), L('Campus and facilities', 'کیمپس اور سہولیات'), L('Everything a modern school needs, in one secure place.'), P.library), coll('facility', { limit: 24 })]);
  add('student-life', L('Student Life', 'طلبہ کی زندگی'), [
    header(L('Student life', 'طلبہ کی زندگی'), L('Life at Alpha', 'اسکول کی زندگی'), L('Clubs, sport, the arts and service — every day.'), P.athletics),
    sec('textImage', { heading: L('More than lessons'), body: L('From sports day to science fairs, debating to art exhibitions, our students discover new talents and make friends for life. Every child is encouraged to join at least one club each term.'), image: P.sports, imagePosition: 'end' }),
    coll('activity', { heading: L('Activities'), limit: 8, viewAll: link('All activities and clubs', 'تمام سرگرمیاں', '/activities-clubs') }, { background: 'muted' })
  ]);
  add('activities-clubs', L('Activities & Clubs', 'سرگرمیاں اور کلب'), [header(L('Student life', 'طلبہ کی زندگی'), L('Activities and clubs', 'سرگرمیاں اور کلب'), {}, P.athletics), coll('activity', { limit: 48 })]);
  add('achievements', L('Achievements', 'کامیابیاں'), [header(L('Recognition', 'اعزازات'), L('Achievements', 'کامیابیاں'), L('Celebrating our students’ success.'), P.graduation), coll('achievement', { limit: 48 })]);
  add('news', L('News', 'خبریں'), [
    header(L('Latest', 'تازہ ترین'), L('News and announcements', 'خبریں اور اعلانات'), {}, P.classSession),
    sec('announcements', { heading: L('Announcements', 'اعلانات'), limit: 20 }),
    coll('news', { heading: L('News', 'خبریں'), limit: 24 })
  ]);
  add('events', L('Events', 'تقریبات'), [header(L('Calendar', 'کیلنڈر'), L('Events', 'تقریبات'), {}, P.auditorium), coll('event', { limit: 24, layout: 'list' })]);
  add('gallery', L('Gallery', 'گیلری'), [header(L('Gallery', 'گیلری'), L('Gallery', 'گیلری'), {}, P.heroYoung), coll('album', { limit: 48 })]);
  add('faqs', L('FAQs', 'عمومی سوالات'), [header(L('Help', 'مدد'), L('Frequently asked questions', 'عمومی سوالات'), {}, P.library), coll('faq', { limit: 48 })]);
  add('contact-us', L('Contact Us', 'رابطہ کریں'), [header(L('Get in touch', 'رابطہ'), L('Contact us', 'رابطہ کریں'), L('We are always happy to hear from you.'), P.heroCampus), sec('contact', {}, { id: 'contact' })]);
  add('privacy-policy', L('Privacy Policy', 'رازداری کی پالیسی'), [header({}, L('Privacy policy', 'رازداری کی پالیسی'), {}, P.reading), sec('richText', { body: L('The Alpha School System respects your privacy. Information shared through this website (such as enquiry forms) is used only to respond to you and is never sold or shared with third parties. Student records are kept securely and accessed only by authorised staff. For questions about your data, please contact the school office.') })]);
  add('terms-conditions', L('Terms & Conditions', 'شرائط و ضوابط'), [header({}, L('Terms and conditions', 'شرائط و ضوابط'), {}, P.reading), sec('richText', { body: L('Content on this website is provided for general information about The Alpha School System, 47 Campus. Fees, dates and policies may change; please confirm details with the school office. Photographs and text may not be reused without permission.') })]);
  return pages;
}

// ---------------------------------------------------------------------------- collection items
export interface AlphaItem { type: string; slug: string; featured: boolean; group: string; order: number; date: string | null; data: Record<string, unknown> }

export function alphaItems(): AlphaItem[] {
  const out: AlphaItem[] = [];
  const add = (type: string, data: Record<string, unknown>, opts: { group?: string; featured?: boolean; date?: string | null } = {}) => {
    const title = (data.title as L10n).en ?? type;
    out.push({ type, slug: slugify(title).slice(0, 80), featured: opts.featured ?? false, group: opts.group ?? '', order: out.filter((i) => i.type === type).length, date: opts.date ?? null, data });
  };

  add('program', { title: L('Early Years'), grades: L('Playgroup · Nursery · Prep'), image: P.early, summary: L('Play-based learning that builds language, number sense, curiosity and confidence in a warm, safe setting.'), subjects: L('Phonics, early maths, Urdu, art, music and outdoor play') });
  add('program', { title: L('Primary School'), grades: L('Grades 1 – 5'), image: P.primary, summary: L('Strong reading, writing and mathematics, with science, computing and the arts woven through every week.'), subjects: L('English, Urdu, Maths, Science, Islamiat, Social Studies, Computing') });
  add('program', { title: L('Middle & Secondary'), grades: L('Grades 6 – 10 (Matric)'), image: P.secondary, summary: L('Subject-specialist teaching, science laboratories and focused board preparation for outstanding Matric results.'), subjects: L('Physics, Chemistry, Biology, Computer Science, Maths, English, Urdu, Pak Studies') });

  add('facility', { title: L('Modern library'), icon: 'library', image: P.library, summary: L('Thousands of books, quiet reading corners and digital resources for every age.') });
  add('facility', { title: L('Science laboratories'), icon: 'flask', image: P.lab, summary: L('Fully equipped physics, chemistry and biology labs for hands-on experiments.') });
  add('facility', { title: L('Computer lab'), icon: 'monitor', image: P.computer, summary: L('Up-to-date computers, coding and robotics for digital confidence.') });
  add('facility', { title: L('Smart classrooms'), icon: 'book', image: P.classrooms, summary: L('Bright, air-conditioned classrooms with multimedia teaching tools.') });
  add('facility', { title: L('Sports grounds'), icon: 'trophy', image: P.sports, summary: L('Football, cricket and athletics with professional coaching.') });
  add('facility', { title: L('Auditorium'), icon: 'music', image: P.auditorium, summary: L('A hall for assemblies, performances, debates and prize-giving.') });

  add('activity', { title: L('Athletics & sports'), image: P.athletics, summary: L('Inter-house competitions, annual sports day and district tournaments.') }, { group: 'sport' });
  add('activity', { title: L('Maths & science club'), image: P.maths, summary: L('Olympiad training, experiments and the annual science fair.') }, { group: 'club' });
  add('activity', { title: L('Reading society'), image: P.reading, summary: L('Book talks, author visits and our popular reading challenge.') }, { group: 'club' });
  add('activity', { title: L('Creative arts'), image: P.arts, summary: L('Drawing, crafts, calligraphy and the end-of-year art exhibition.') }, { group: 'cultural' });

  add('faculty', { title: L('Mrs. Sarah Ahmed'), designation: L('Principal'), qualifications: L('M.Phil Education · 18 years’ experience'), image: P.principal }, { group: 'leadership' });
  add('faculty', { title: L('Mr. Imran Qureshi'), designation: L('Vice Principal — Academics'), qualifications: L('M.Sc Mathematics, B.Ed'), image: P.f1 }, { group: 'leadership' });
  add('faculty', { title: L('Ms. Ayesha Malik'), designation: L('Head of Primary'), qualifications: L('M.A English, M.Ed'), image: P.f2 }, { group: 'leadership' });
  add('faculty', { title: L('Mr. Usman Tariq'), designation: L('Head of Sciences'), qualifications: L('M.Sc Physics'), image: P.f3 }, { group: 'leadership' });

  add('testimonial', { title: L('Mrs. Nadia Khan'), relation: L('Parent, Grade 4'), image: P.p1, quote: L('The teachers at Alpha know my daughter so well. She has grown in confidence every single term, and we always know exactly how she is doing.') }, { group: 'parent' });
  add('testimonial', { title: L('Mr. Bilal Hussain'), relation: L('Parent, Grade 8'), image: P.p2, quote: L('Excellent academics, but also real care for character. The SMS updates and parent portal make us feel part of the school.') }, { group: 'parent' });
  add('testimonial', { title: L('Hamza Iqbal'), relation: L('Alumnus, Class of 2024'), image: P.p3, quote: L('Alpha gave me the discipline and the self-belief to study engineering. I still visit my teachers whenever I can.') }, { group: 'alumni' });

  add('achievement', { title: L('100% Matric pass rate'), year: '2026', image: P.graduation, summary: L('Every candidate passed, with 42 students achieving A+ grades.') });
  add('achievement', { title: L('Inter-school science fair winners'), year: '2026', image: P.lab, summary: L('First prize for our Grade 9 renewable-energy project.') });
  add('achievement', { title: L('District athletics champions'), year: '2025', image: P.athletics, summary: L('Gold in the 4×100 m relay and the long jump.') });

  add('news', { title: L('Alpha students shine in Matric results'), date: '2026-11-10', image: P.graduation, summary: L('A record 42 A+ grades and a 100% pass rate for the Class of 2026.'), body: L('We are delighted to congratulate the Class of 2026 on an outstanding set of Matric results. Every candidate passed, and 42 students achieved A+ grades.\n\nThank you to our dedicated teachers and supportive families. Well done, Alphians!') }, { date: '2026-11-10', featured: true });
  add('news', { title: L('New computer lab opens at 47 Campus'), date: '2026-10-22', image: P.computer, summary: L('Forty new workstations bring coding and robotics to every grade.'), body: L('Our new computer lab was opened this week. Students from Grade 3 upwards will now enjoy weekly coding and robotics lessons.') }, { date: '2026-10-22' });
  add('news', { title: L('Annual sports day — a day of champions'), date: '2026-10-05', image: P.sports, summary: L('Houses competed in athletics, football and tug-of-war in front of proud families.'), body: L('Thank you to all families who joined us for a wonderful sports day. Congratulations to Blue House on winning the trophy!') }, { date: '2026-10-05' });

  add('event', { title: L('Winter parent–teacher meeting'), startAt: '2026-12-05T04:00:00.000Z', endAt: '2026-12-05T08:00:00.000Z', location: L('47 Campus, all classrooms'), image: P.classSession, summary: L('Meet your child’s teachers and review first-term progress.') }, { date: '2026-12-05' });
  add('event', { title: L('Annual prize-giving ceremony'), startAt: '2026-12-18T05:00:00.000Z', endAt: '2026-12-18T08:00:00.000Z', location: L('School auditorium'), image: P.auditorium, summary: L('Celebrating academic, sporting and character awards.') }, { date: '2026-12-18' });
  add('event', { title: L('Admissions open day'), startAt: '2027-01-16T05:00:00.000Z', endAt: '2027-01-16T09:00:00.000Z', location: L('47 Campus'), image: P.firstDay, summary: L('Campus tours, meet the teachers and on-the-spot admission guidance.') }, { date: '2027-01-16' });

  const media = (list: MediaRef[]) => list.map((m, k) => ({ id: `m${k + 1}`, media: m, caption: m.alt ?? {} }));
  add('album', { title: L('Life on campus'), image: P.heroCampus, summary: L('Our classrooms, library and grounds.'), media: media([P.heroCampus, P.library, P.classrooms, P.lab, P.computer, P.auditorium]) }, { group: 'campus' });
  add('album', { title: L('In the classroom'), image: P.heroClass, summary: L('Learning in action across every grade.'), media: media([P.heroClass, P.heroYoung, P.classSession, P.early, P.primary, P.secondary]) }, { group: 'academics' });
  add('album', { title: L('Sports & celebrations'), image: P.athletics, summary: L('Sports day, prize-giving and graduation.'), media: media([P.athletics, P.sports, P.graduation, P.loveToLearn]) }, { group: 'events' });

  add('faq', { title: L('When do admissions open?'), answer: L('Admissions for the 2027–28 session are open now. Applications are accepted until seats in each class are filled.') }, { group: 'admissions' });
  add('faq', { title: L('Which classes do you offer?'), answer: L('Playgroup to Grade 10 (Matric), with separate science and computer science groups in Grades 9 and 10.') }, { group: 'general' });
  add('faq', { title: L('Is transport available?'), answer: L('Yes. Supervised school vans cover most nearby areas. Please ask the office for routes and fees.') }, { group: 'general' });
  add('faq', { title: L('How do parents stay informed?'), answer: L('Through our online parent portal, SMS alerts for attendance and results, and termly parent–teacher meetings.') }, { group: 'general' });
  add('faq', { title: L('What documents are required for admission?'), answer: L('B-Form or birth certificate, two photographs, parents’ CNIC copies, and the previous school’s report and leaving certificate.') }, { group: 'admissions' });
  return out;
}

// ---------------------------------------------------------------------------- site-wide configuration
export function alphaSiteContent(): Record<string, unknown> {
  const site = defaultSiteContent({ name: ALPHA_BRAND.name, description: ALPHA_BRAND.description, primaryColor: ALPHA_BRAND.primaryColor, accentColor: ALPHA_BRAND.accentColor });
  return {
    ...site,
    footer: { ...(site.footer as object), about: L(ALPHA_BRAND.description) },
    contact: {
      address: L('The Alpha School System, 47 Campus\nMain Boulevard, Block 47\nPakistan'),
      phones: ['+92 300 0000047', '+92 42 0000 0047'], email: 'info@alpha47campus.edu.pk',
      admissionsPhone: '+92 300 0000470', admissionsEmail: 'admissions@alpha47campus.edu.pk',
      officeHours: L('Monday – Friday: 7:30 am – 2:30 pm\nSaturday: 8:00 am – 12:00 pm'),
      mapEmbedUrl: '',
      social: { facebook: 'https://www.facebook.com/', instagram: 'https://www.instagram.com/', youtube: 'https://www.youtube.com/', x: '', linkedin: '', whatsapp: '' }
    },
    theme: { preset: 'alpha', primary: ALPHA_BRAND.primaryColor, secondary: '#0d1033', accent: ALPHA_BRAND.accentColor, background: 'mist', headingFont: 'serif-modern', bodyFont: 'sans', radius: 'soft', buttonStyle: 'solid', headerStyle: 'overlay', footerStyle: 'dark' },
    seo: { siteTitle: L('The Alpha School System — 47 Campus'), description: L(ALPHA_BRAND.description), ogImage: P.heroClass, allowIndexing: true, structuredData: true }
  };
}
