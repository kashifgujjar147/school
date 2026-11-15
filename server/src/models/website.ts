import { Schema, model } from 'mongoose';
import { ITEM_TYPES, MEDIA_KINDS, MEDIA_PROVIDERS } from '@sms/shared';
import { syncedDef, syncedFields, uuidId, baseOptions } from './plugins.js';

/**
 * Website CMS collections. All of them are new and additive: no existing collection or document
 * is changed. Structured content (`draft`, `published`, `data`, `snapshot`) is stored as Mixed and
 * is ALWAYS validated with the shared Zod schemas before it is written (see services/website.ts).
 *
 * Draft and published content are stored separately: public endpoints only ever read `published`.
 */

/** Site-wide configuration (navigation, footer, contact, theme, SEO, languages). Singleton `_id: "site"`. */
const websiteConfigSchema = new Schema({
  _id: { type: String, default: 'site' },
  draft: { type: Schema.Types.Mixed, required: true },
  published: { type: Schema.Types.Mixed, default: null },
  /** true when `draft` differs from `published`. */
  dirty: { type: Boolean, default: true },
  publishedAt: { type: Date, default: null }, publishedBy: String,
  /** Custom domain: { domain, token, status: 'unverified'|'verified'|'failed', checkedAt, lastError }. */
  domain: { type: Schema.Types.Mixed, default: null },
  updatedBy: String,
  ...syncedDef
}, { ...baseOptions, minimize: false });
syncedFields(websiteConfigSchema);
export const WebsiteConfig = model('WebsiteConfig', websiteConfigSchema, 'websiteconfig');

const websitePageSchema = new Schema({
  _id: uuidId,
  slug: { type: String, required: true, maxlength: 80 },
  /** Key of a built-in page (home, about-us, …). Built-in pages can be unpublished but not deleted. */
  systemKey: { type: String, default: null },
  order: { type: Number, default: 0 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  draft: { type: Schema.Types.Mixed, required: true },
  published: { type: Schema.Types.Mixed, default: null },
  dirty: { type: Boolean, default: true },
  publishedAt: { type: Date, default: null }, publishedBy: String,
  /** When set, the background job publishes the current draft at this time. */
  scheduledAt: { type: Date, default: null },
  createdBy: String, updatedBy: String,
  ...syncedDef
}, { ...baseOptions, minimize: false });
syncedFields(websitePageSchema);
websitePageSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
websitePageSchema.index({ status: 1, order: 1 });
websitePageSchema.index({ scheduledAt: 1 }, { sparse: true });
export const WebsitePage = model('WebsitePage', websitePageSchema, 'websitepages');

/** News, events, faculty, testimonials, FAQs, programmes, facilities, activities, achievements, gallery albums. */
const websiteItemSchema = new Schema({
  _id: uuidId,
  type: { type: String, enum: ITEM_TYPES, required: true },
  slug: { type: String, required: true, maxlength: 80 },
  status: { type: String, enum: ['draft', 'published', 'archived'], default: 'draft' },
  featured: { type: Boolean, default: false },
  group: { type: String, default: '' },
  order: { type: Number, default: 0 },
  /** Sort date: news date, event start. */
  date: { type: Date, default: null },
  data: { type: Schema.Types.Mixed, required: true },
  publishedAt: { type: Date, default: null },
  createdBy: String, updatedBy: String,
  ...syncedDef
}, { ...baseOptions, minimize: false });
syncedFields(websiteItemSchema);
websiteItemSchema.index({ type: 1, slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
websiteItemSchema.index({ type: 1, status: 1, order: 1 });
websiteItemSchema.index({ type: 1, status: 1, date: -1 });
export const WebsiteItem = model('WebsiteItem', websiteItemSchema, 'websiteitems');

const websiteMediaSchema = new Schema({
  _id: uuidId,
  kind: { type: String, enum: MEDIA_KINDS, required: true },
  provider: { type: String, enum: MEDIA_PROVIDERS, required: true },
  /** How it got here: uploaded to this server, uploaded to Cloudinary from the dashboard, or pasted URL. */
  source: { type: String, enum: ['upload', 'cloudinary_upload', 'url'], required: true },
  url: { type: String, required: true, maxlength: 1000 },
  publicId: String, embedUrl: String,
  mime: String, sizeBytes: Number, width: Number, height: Number, durationSec: Number,
  originalName: String,
  title: { type: String, default: '' },
  category: { type: String, default: '' },
  alt: { type: Schema.Types.Mixed, default: () => ({}) },
  caption: { type: Schema.Types.Mixed, default: () => ({}) },
  archivedAt: { type: Date, default: null },
  createdBy: String,
  ...syncedDef
}, { ...baseOptions, minimize: false });
syncedFields(websiteMediaSchema);
websiteMediaSchema.index({ kind: 1, archivedAt: 1, createdAt: -1 });
websiteMediaSchema.index({ category: 1 });
export const WebsiteMedia = model('WebsiteMedia', websiteMediaSchema, 'websitemedia');

/** Snapshot of a page or of the site configuration, taken on every publish and restore. */
const websiteRevisionSchema = new Schema({
  _id: uuidId,
  scope: { type: String, enum: ['page', 'site'], required: true },
  pageId: { type: String, default: null }, pageSlug: String,
  action: { type: String, enum: ['publish', 'unpublish', 'restore', 'seed'], required: true },
  snapshot: { type: Schema.Types.Mixed, required: true },
  title: String, createdBy: String, createdByName: String,
  ...syncedDef
}, { ...baseOptions, minimize: false });
syncedFields(websiteRevisionSchema);
websiteRevisionSchema.index({ scope: 1, pageId: 1, createdAt: -1 });
export const WebsiteRevision = model('WebsiteRevision', websiteRevisionSchema, 'websiterevisions');

/** Messages sent from the public contact / admission inquiry forms. */
const websiteInquirySchema = new Schema({
  _id: uuidId,
  kind: { type: String, enum: ['contact', 'admission'], required: true },
  name: { type: String, required: true }, phone: String, email: String, grade: String, message: String, lang: String,
  status: { type: String, enum: ['new', 'read', 'closed'], default: 'new' },
  handledBy: String,
  ...syncedDef
}, baseOptions);
syncedFields(websiteInquirySchema);
websiteInquirySchema.index({ status: 1, createdAt: -1 });
export const WebsiteInquiry = model('WebsiteInquiry', websiteInquirySchema, 'websiteinquiries');

export const WEBSITE_COLLECTIONS = ['websiteconfig', 'websitepages', 'websiteitems', 'websitemedia', 'websiterevisions', 'websiteinquiries'] as const;
