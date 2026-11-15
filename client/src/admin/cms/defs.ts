import { ITEM_GROUPS, SECTION_ICONS, type ItemType, type SectionType } from '@sms/shared';

/**
 * Describes every editable shape once; the generic form (fields.tsx) renders it. Adding a field to
 * a section or collection type means adding one line here (the server schema is the authority).
 */
export type Field = { k: string; label: string; hint?: string; when?: (v: Record<string, any>) => boolean } & ( // eslint-disable-line @typescript-eslint/no-explicit-any
  | { type: 'l10n'; multiline?: boolean; rows?: number; max?: number }
  | { type: 'text'; max?: number; placeholder?: string; ltr?: boolean }
  | { type: 'number'; min?: number; max?: number; step?: number }
  | { type: 'bool' } | { type: 'date' } | { type: 'datetime' } | { type: 'color' }
  | { type: 'select'; options: [string, string][]; numeric?: boolean }
  | { type: 'media'; kind: 'image' | 'video' | 'any'; fileOnly?: boolean }
  | { type: 'link' }
  | { type: 'list'; fields: Field[]; addLabel: string; max: number; titleKey?: string; blank?: () => Record<string, unknown> }
);

const heading: Field[] = [
  { k: 'eyebrow', label: 'Small label above the heading', type: 'l10n', max: 120 },
  { k: 'heading', label: 'Heading', type: 'l10n', max: 200 },
  { k: 'intro', label: 'Introduction', type: 'l10n', multiline: true, rows: 3, max: 1200 }
];
const icon: Field = { k: 'icon', label: 'Icon', type: 'select', options: [['', 'None'], ...SECTION_ICONS.map((i) => [i, i[0]!.toUpperCase() + i.slice(1)] as [string, string])] };

const heroSlide: Field[] = [
  { k: 'active', label: 'Show this slide', type: 'bool' },
  { k: 'eyebrow', label: 'Small label', type: 'l10n', max: 120 },
  { k: 'headline', label: 'Headline', type: 'l10n', max: 200 },
  { k: 'description', label: 'Description', type: 'l10n', multiline: true, rows: 3, max: 500 },
  { k: 'cta1', label: 'Primary button', type: 'link' },
  { k: 'cta2', label: 'Secondary button', type: 'link' },
  { k: 'mediaType', label: 'Background', type: 'select', options: [['none', 'Brand colour (no media)'], ['image', 'Image'], ['video', 'Video']] },
  { k: 'desktop', label: 'Desktop / tablet media', type: 'media', kind: 'any', fileOnly: true, when: (v) => v.mediaType !== 'none', hint: 'Landscape, at least 1920 px wide. Videos: MP4/WebM file or Cloudinary video (YouTube/Vimeo cannot be a muted background).' },
  { k: 'mobile', label: 'Mobile media (optional)', type: 'media', kind: 'any', fileOnly: true, when: (v) => v.mediaType !== 'none', hint: 'Portrait crop for phones. Without it, phones show the poster instead of downloading the desktop video.' },
  { k: 'poster', label: 'Video poster image', type: 'media', kind: 'image', when: (v) => v.mediaType === 'video', hint: 'Shown while the video loads, on phones, and if the video cannot play. It is not a separate slide.' },
  { k: 'durationSec', label: 'Duration (seconds)', type: 'number', min: 3, max: 120, step: 1, hint: 'How long an image slide stays on screen.' },
  { k: 'videoOverride', label: 'Move on after the duration instead of when the video ends', type: 'bool', when: (v) => v.mediaType === 'video' },
  { k: 'align', label: 'Text position', type: 'select', options: [['start', 'Start'], ['center', 'Centre'], ['end', 'End']] },
  { k: 'valign', label: 'Vertical position', type: 'select', options: [['bottom', 'Bottom'], ['middle', 'Middle']] },
  { k: 'overlay', label: 'Overlay darkness (%)', type: 'number', min: 0, max: 85, step: 5, when: (v) => v.mediaType !== 'none' },
  { k: 'overlayStyle', label: 'Overlay style', type: 'select', options: [['gradient', 'Gradient'], ['solid', 'Solid']], when: (v) => v.mediaType !== 'none' },
  { k: 'animation', label: 'Animation', type: 'select', options: [['zoom', 'Slow zoom'], ['fade', 'Fade'], ['slide', 'Gentle slide']] },
  { k: 'startAt', label: 'Show from (optional)', type: 'datetime' },
  { k: 'endAt', label: 'Show until (optional)', type: 'datetime' }
];
export const blankSlide = () => ({ active: true, mediaType: 'none', eyebrow: {}, headline: {}, description: {}, cta1: null, cta2: null, desktop: null, mobile: null, poster: null, align: 'start', valign: 'bottom', overlay: 45, overlayStyle: 'gradient', animation: 'zoom', durationSec: 7, videoOverride: false, startAt: null, endAt: null });

const ITEM_TYPE_OPTIONS: [string, string][] = [['news', 'News'], ['event', 'Events'], ['faculty', 'Faculty & leadership'], ['testimonial', 'Testimonials'], ['faq', 'FAQs'], ['program', 'Academic programmes'], ['facility', 'Facilities'], ['activity', 'Activities & clubs'], ['achievement', 'Achievements'], ['album', 'Gallery albums']];

export const SECTION_DEFS: Record<SectionType, { label: string; about: string; fields: Field[] }> = {
  hero: { label: 'Hero', about: 'Full-width slides with image or video backgrounds', fields: [
    { k: 'height', label: 'Height', type: 'select', options: [['full', 'Full screen'], ['tall', 'Tall'], ['medium', 'Medium']] },
    { k: 'slides', label: 'Slides', type: 'list', fields: heroSlide, addLabel: 'Add slide', max: 12, titleKey: 'headline', blank: blankSlide }
  ] },
  pageHeader: { label: 'Page header', about: 'Title banner at the top of an inner page', fields: [...heading.map((f) => (f.k === 'heading' ? { ...f, label: 'Page heading' } : f)), { k: 'image', label: 'Background image (optional)', type: 'media', kind: 'image' }] },
  textImage: { label: 'Text and image', about: 'Story block with an image or video; also used for the Principal’s welcome', fields: [
    ...heading, { k: 'body', label: 'Text', type: 'l10n', multiline: true, rows: 8, max: 6000, hint: 'Leave a blank line between paragraphs.' },
    { k: 'image', label: 'Image', type: 'media', kind: 'image' }, { k: 'video', label: 'Video (optional)', type: 'media', kind: 'video' },
    { k: 'imagePosition', label: 'Media side', type: 'select', options: [['end', 'After the text'], ['start', 'Before the text']] },
    { k: 'personName', label: 'Signature name (optional)', type: 'l10n', max: 120 }, { k: 'personTitle', label: 'Signature title', type: 'l10n', max: 160 },
    { k: 'cta', label: 'Link', type: 'link' }
  ] },
  stats: { label: 'Statistics', about: 'Animated figures. Use live counts from school records or type verified numbers', fields: [...heading, { k: 'items', label: 'Figures', type: 'list', addLabel: 'Add figure', max: 8, titleKey: 'label', blank: () => ({ label: {}, source: 'manual', value: null, suffix: '' }), fields: [
    { k: 'label', label: 'Label', type: 'l10n', max: 80 },
    { k: 'source', label: 'Number comes from', type: 'select', options: [['manual', 'A number I type'], ['students', 'Live: active students'], ['teachers', 'Live: active teachers'], ['classes', 'Live: classes']] },
    { k: 'value', label: 'Number', type: 'number', min: 0, when: (v) => v.source === 'manual', hint: 'Only publish figures the school can stand behind.' },
    { k: 'suffix', label: 'Suffix (e.g. +, %)', type: 'text', max: 6 }
  ] }] },
  featureGrid: { label: 'Feature grid', about: 'Cards with icon or image, title and text', fields: [...heading,
    { k: 'columns', label: 'Columns', type: 'select', numeric: true, options: [['2', '2'], ['3', '3'], ['4', '4']] },
    { k: 'style', label: 'Style', type: 'select', options: [['cards', 'Cards'], ['images', 'Images'], ['minimal', 'Minimal']] },
    { k: 'items', label: 'Cards', type: 'list', addLabel: 'Add card', max: 24, titleKey: 'title', blank: () => ({ icon: 'star', title: {}, body: {}, image: null, link: null }), fields: [
      { k: 'title', label: 'Title', type: 'l10n', max: 160 }, { k: 'body', label: 'Text', type: 'l10n', multiline: true, rows: 3, max: 1200 }, icon,
      { k: 'image', label: 'Image', type: 'media', kind: 'image' }, { k: 'link', label: 'Link', type: 'link' }
    ] }
  ] },
  collection: { label: 'Content list', about: 'Shows published entries: news, events, faculty, programmes, FAQs, testimonials…', fields: [...heading,
    { k: 'itemType', label: 'Show', type: 'select', options: ITEM_TYPE_OPTIONS },
    { k: 'group', label: 'Only this group (optional)', type: 'text', max: 60, hint: 'e.g. leadership, admissions' },
    { k: 'limit', label: 'How many', type: 'number', min: 1, max: 48, step: 1 },
    { k: 'layout', label: 'Layout', type: 'select', options: [['grid', 'Grid'], ['list', 'List'], ['carousel', 'Carousel (testimonials)']] },
    { k: 'featuredOnly', label: 'Featured entries only', type: 'bool' }, { k: 'viewAll', label: '"View all" link', type: 'link' }
  ] },
  gallery: { label: 'Image gallery', about: 'Image grid with a full-screen viewer', fields: [...heading, { k: 'images', label: 'Images', type: 'list', addLabel: 'Add image', max: 60, titleKey: 'caption', blank: () => ({ media: null, caption: {} }), fields: [{ k: 'media', label: 'Image or video', type: 'media', kind: 'any' }, { k: 'caption', label: 'Caption', type: 'l10n', max: 200 }] }] },
  video: { label: 'Video', about: 'One video: uploaded file, Cloudinary, YouTube or Vimeo', fields: [...heading, { k: 'video', label: 'Video', type: 'media', kind: 'video' }, { k: 'poster', label: 'Poster image', type: 'media', kind: 'image' }] },
  cta: { label: 'Call to action', about: 'Short invitation with one or two buttons', fields: [...heading, { k: 'cta1', label: 'Primary button', type: 'link' }, { k: 'cta2', label: 'Secondary button', type: 'link' }, { k: 'image', label: 'Background image (optional)', type: 'media', kind: 'image' }] },
  steps: { label: 'Steps', about: 'Numbered steps, e.g. the admission process', fields: [...heading, { k: 'items', label: 'Steps', type: 'list', addLabel: 'Add step', max: 12, titleKey: 'title', blank: () => ({ title: {}, body: {} }), fields: [{ k: 'title', label: 'Title', type: 'l10n', max: 160 }, { k: 'body', label: 'Text', type: 'l10n', multiline: true, rows: 3, max: 1200 }] }] },
  richText: { label: 'Text', about: 'Long-form text such as history or policies', fields: [...heading, { k: 'body', label: 'Text', type: 'l10n', multiline: true, rows: 14, max: 30000, hint: 'Leave a blank line between paragraphs.' }] },
  contact: { label: 'Contact', about: 'Contact details, inquiry form and map', fields: [...heading,
    { k: 'showDetails', label: 'Show address, phone and email', type: 'bool' }, { k: 'showForm', label: 'Show the form', type: 'bool' },
    { k: 'formType', label: 'Form', type: 'select', options: [['contact', 'General message'], ['admission', 'Admission inquiry']], when: (v) => v.showForm },
    { k: 'showMap', label: 'Show the map (set it in Contact information)', type: 'bool' }
  ] },
  announcements: { label: 'Announcements', about: 'The school notice board (News & Events → Announcements)', fields: [...heading, { k: 'limit', label: 'How many', type: 'number', min: 1, max: 20, step: 1 }] }
};

/** The "Add section" palette: named templates, some of which are presets of the content list. */
export const SECTION_TEMPLATES: { label: string; type: SectionType; content?: Record<string, unknown>; background?: string }[] = [
  { label: 'Hero', type: 'hero', content: { slides: [{ id: 'slide-1', ...blankSlide() }] } },
  { label: 'Page header', type: 'pageHeader' },
  { label: 'Text and image', type: 'textImage' },
  { label: 'Image gallery', type: 'gallery' },
  { label: 'Statistics', type: 'stats', background: 'brand' },
  { label: 'Feature grid', type: 'featureGrid' },
  { label: 'Academic programmes', type: 'collection', content: { itemType: 'program', limit: 6 } },
  { label: 'Leadership profiles', type: 'collection', content: { itemType: 'faculty', group: 'leadership', limit: 8 } },
  { label: 'Testimonials', type: 'collection', content: { itemType: 'testimonial', layout: 'carousel', limit: 6 }, background: 'dark' },
  { label: 'Video', type: 'video' },
  { label: 'Call to action', type: 'cta', background: 'brand' },
  { label: 'FAQ', type: 'collection', content: { itemType: 'faq', limit: 12 } },
  { label: 'News grid', type: 'collection', content: { itemType: 'news', limit: 3 } },
  { label: 'Events', type: 'collection', content: { itemType: 'event', layout: 'list', limit: 4 } },
  { label: 'Steps', type: 'steps' },
  { label: 'Text', type: 'richText' },
  { label: 'Announcements', type: 'announcements' },
  { label: 'Contact', type: 'contact' }
];

const title = (label = 'Title'): Field => ({ k: 'title', label, type: 'l10n', max: 200 });
const summary = (label = 'Short summary'): Field => ({ k: 'summary', label, type: 'l10n', multiline: true, rows: 3, max: 600 });
const image = (label = 'Image'): Field => ({ k: 'image', label, type: 'media', kind: 'image' });
const body: Field = { k: 'body', label: 'Full text', type: 'l10n', multiline: true, rows: 12, max: 30000, hint: 'Leave a blank line between paragraphs.' };

export const ITEM_DEFS: Record<ItemType, { label: string; singular: string; fields: Field[]; groups: string[] }> = {
  news: { label: 'News & articles', singular: 'article', groups: ITEM_GROUPS.news ?? [], fields: [title(), { k: 'date', label: 'Date', type: 'date' }, summary(), image('Main image'), body, { k: 'video', label: 'Video (optional)', type: 'media', kind: 'video' }] },
  event: { label: 'Events', singular: 'event', groups: [], fields: [title(), { k: 'startAt', label: 'Starts', type: 'datetime' }, { k: 'endAt', label: 'Ends (optional)', type: 'datetime' }, { k: 'location', label: 'Location', type: 'l10n', max: 200 }, summary(), image(), body] },
  faculty: { label: 'Faculty & leadership', singular: 'profile', groups: ITEM_GROUPS.faculty ?? [], fields: [title('Name'), { k: 'designation', label: 'Designation', type: 'l10n', max: 160 }, { k: 'qualifications', label: 'Qualifications', type: 'l10n', max: 300 }, image('Photograph'), summary('Short biography')] },
  testimonial: { label: 'Testimonials', singular: 'testimonial', groups: ITEM_GROUPS.testimonial ?? [], fields: [title('Name'), { k: 'relation', label: 'Relationship (e.g. Parent of a Grade 5 student)', type: 'l10n', max: 120 }, { k: 'quote', label: 'Testimonial', type: 'l10n', multiline: true, rows: 5, max: 1200, hint: 'Only publish words the person really said and agreed to share.' }, image('Photograph (optional)')] },
  faq: { label: 'FAQs', singular: 'question', groups: ITEM_GROUPS.faq ?? [], fields: [title('Question'), { k: 'answer', label: 'Answer', type: 'l10n', multiline: true, rows: 6, max: 4000 }] },
  program: { label: 'Academic programmes', singular: 'programme', groups: [], fields: [title(), { k: 'grades', label: 'Classes / grade levels', type: 'l10n', max: 200 }, summary(), { k: 'subjects', label: 'Subjects', type: 'l10n', multiline: true, rows: 2, max: 600 }, image(), { ...body, max: 12000 }] },
  facility: { label: 'Campus & facilities', singular: 'facility', groups: [], fields: [title(), summary('Description'), image(), icon] },
  activity: { label: 'Activities & clubs', singular: 'activity', groups: ITEM_GROUPS.activity ?? [], fields: [title(), summary('Description'), image()] },
  achievement: { label: 'Achievements', singular: 'achievement', groups: ITEM_GROUPS.achievement ?? [], fields: [title(), { k: 'year', label: 'Year', type: 'text', max: 12 }, summary('Description'), image()] },
  album: { label: 'Gallery albums', singular: 'album', groups: ITEM_GROUPS.album ?? [], fields: [title(), summary('Description'), image('Cover image'), { k: 'media', label: 'Photos and videos', type: 'list', addLabel: 'Add photo or video', max: 200, titleKey: 'caption', blank: () => ({ media: null, caption: {} }), fields: [{ k: 'media', label: 'Image or video', type: 'media', kind: 'any' }, { k: 'caption', label: 'Caption', type: 'l10n', max: 200 }] }] }
};
