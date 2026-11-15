/**
 * Fixed interface text of the public website (buttons, form labels, empty states). Page content is
 * edited per language in the CMS; these are the few strings that are not content. A language
 * without an entry here falls back to English, so enabling another language never breaks the site.
 */
const en = {
  menu: 'Menu', close: 'Close', skipToContent: 'Skip to content', staffLogin: 'Staff sign in', language: 'Language',
  readMore: 'Read more', viewAll: 'View all', backTo: 'Back', previous: 'Previous', next: 'Next', slide: 'Slide {n} of {total}',
  heroLabel: 'Highlights', playVideo: 'Play video', openImage: 'Open image', imageOf: 'Image {n} of {total}',
  searchFaqs: 'Search questions', noResults: 'Nothing matches your search.', nothingYet: 'There is nothing to show here yet.',
  upcoming: 'Upcoming', past: 'Past', photos: '{n} photos', allDay: 'All day',
  contact: 'Contact', address: 'Address', phone: 'Phone', email: 'Email', officeHours: 'Office hours', admissionsOffice: 'Admissions office', followUs: 'Follow us', map: 'Map',
  formName: 'Your name', formPhone: 'Phone number', formEmail: 'Email address', formGrade: 'Class / grade applying for', formMessage: 'Message',
  formSend: 'Send message', formSendInquiry: 'Send inquiry', formSending: 'Sending…', formNeedContact: 'Please enter a phone number or an email address.',
  formThanks: 'Thank you. Your message has been received and the school office will contact you.', formError: 'Your message could not be sent. Please try again or call the school office.',
  formTooMany: 'Too many messages were sent from this connection. Please try again later.',
  notFoundTitle: 'Page not found', notFoundBody: 'The page you are looking for does not exist or is not published.', backHome: 'Back to the home page',
  offlineTitle: 'The website is not available', offlineBody: 'The school website is not published at the moment.',
  errorTitle: 'Something went wrong', errorBody: 'The page could not be loaded. Please check your connection and try again.', retry: 'Try again',
  previewBanner: 'Draft preview — visitors cannot see this version.', previewNeedsLogin: 'Sign in to the dashboard to preview drafts.',
  rights: 'All rights reserved.', announcements: 'Announcements', pinned: 'Pinned', quote: 'Testimonial'
};
export type SiteStrings = typeof en;

const ur: Partial<SiteStrings> = {
  menu: 'مینو', close: 'بند کریں', skipToContent: 'مواد پر جائیں', staffLogin: 'عملہ سائن ان', language: 'زبان',
  readMore: 'مزید پڑھیں', viewAll: 'سب دیکھیں', backTo: 'واپس', previous: 'پچھلا', next: 'اگلا', slide: 'سلائیڈ {n} از {total}',
  heroLabel: 'نمایاں', playVideo: 'ویڈیو چلائیں', openImage: 'تصویر کھولیں', imageOf: 'تصویر {n} از {total}',
  searchFaqs: 'سوالات تلاش کریں', noResults: 'آپ کی تلاش سے کوئی نتیجہ نہیں ملا۔', nothingYet: 'یہاں ابھی دکھانے کے لیے کچھ نہیں ہے۔',
  upcoming: 'آنے والی', past: 'گزشتہ', photos: '{n} تصاویر', allDay: 'پورا دن',
  contact: 'رابطہ', address: 'پتہ', phone: 'فون', email: 'ای میل', officeHours: 'دفتری اوقات', admissionsOffice: 'دفترِ داخلہ', followUs: 'ہمیں فالو کریں', map: 'نقشہ',
  formName: 'آپ کا نام', formPhone: 'فون نمبر', formEmail: 'ای میل پتہ', formGrade: 'مطلوبہ جماعت', formMessage: 'پیغام',
  formSend: 'پیغام بھیجیں', formSendInquiry: 'درخواست بھیجیں', formSending: 'بھیجا جا رہا ہے…', formNeedContact: 'براہِ کرم فون نمبر یا ای میل درج کریں۔',
  formThanks: 'شکریہ۔ آپ کا پیغام موصول ہو گیا ہے، اسکول کا دفتر آپ سے رابطہ کرے گا۔', formError: 'آپ کا پیغام نہیں بھیجا جا سکا۔ دوبارہ کوشش کریں یا اسکول کے دفتر کو فون کریں۔',
  formTooMany: 'اس کنکشن سے بہت زیادہ پیغامات بھیجے گئے ہیں۔ براہِ کرم کچھ دیر بعد کوشش کریں۔',
  notFoundTitle: 'صفحہ نہیں ملا', notFoundBody: 'آپ جو صفحہ تلاش کر رہے ہیں وہ موجود نہیں یا شائع نہیں ہوا۔', backHome: 'سرورق پر واپس',
  offlineTitle: 'ویب سائٹ دستیاب نہیں', offlineBody: 'اسکول کی ویب سائٹ فی الحال شائع نہیں ہے۔',
  errorTitle: 'کچھ غلط ہو گیا', errorBody: 'صفحہ لوڈ نہیں ہو سکا۔ اپنا کنکشن چیک کریں اور دوبارہ کوشش کریں۔', retry: 'دوبارہ کوشش کریں',
  previewBanner: 'مسودے کا پیش منظر — زائرین یہ ورژن نہیں دیکھ سکتے۔', previewNeedsLogin: 'مسودہ دیکھنے کے لیے ڈیش بورڈ میں سائن ان کریں۔',
  rights: 'جملہ حقوق محفوظ ہیں۔', announcements: 'اعلانات', pinned: 'اہم', quote: 'رائے'
};

const DICTS: Record<string, Partial<SiteStrings>> = { en, ur };

export function siteString(lang: string, key: keyof SiteStrings, vars?: Record<string, string | number>): string {
  let s: string = DICTS[lang]?.[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
