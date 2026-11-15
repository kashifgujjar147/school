import 'dotenv/config';
import { z } from 'zod';
import { APP_MODES, PACKAGES } from '@sms/shared';

const hex64 = z.string().regex(/^[0-9a-f]{64,}$/i, 'must be at least 64 hex chars');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_MODE: z.enum(APP_MODES).default('local'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(8080),
  APP_URL: z.string().url().default('http://localhost:8080'),
  CORS_ORIGINS: z.string().default(''),
  COOKIE_SECURE: z.string().default('false').transform((v) => v === 'true'),
  TRUST_PROXY: z.string().default('0'),
  SCHOOL_INSTALL_ID: z.string().regex(/^[a-z0-9-]{3,64}$/),
  NODE_ID: z.string().regex(/^[a-z0-9-]{3,64}$/),
  PACKAGE: z.enum(PACKAGES).default('starter'),
  MONGODB_URI: z.string().min(10),
  MONGODB_DB_NAME: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
  ATLAS_SYNC_URI: z.string().optional().default(''),
  ATLAS_SYNC_DB_NAME: z.string().optional().default(''),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(60),
  SESSION_SECRET: hex64,
  DATA_ENCRYPTION_KEY: hex64,
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(720).default(12),
  SESSION_IDLE_MINUTES: z.coerce.number().min(5).max(10080).default(120),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(50).default(5),
  /** Sign-in attempts per IP per 15 minutes (brute-force protection). */
  LOGIN_RATE_LIMIT: z.coerce.number().int().min(5).max(10_000).default(30),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /** Public "Create account" on the sign-in page. New accounts are pending until an administrator assigns a role. */
  REGISTRATION_ENABLED: z.string().default('true').transform((v) => v !== 'false'),
  /**
   * One-time secret for the web first-administrator setup (/setup). Setup is only possible while the
   * database has no active principal/admin AND this token is set. Leave empty to disable web setup.
   */
  SETUP_TOKEN: z.string().optional().default('').refine((v) => v === '' || v.length >= 16, 'must be at least 16 characters (or empty to disable)'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  BACKUP_DIR: z.string().default('./data/backups'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SMS_PROVIDER: z.enum(['none', 'twilio', 'http']).default('none'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_FROM: z.string().optional().default(''),
  SMS_HTTP_URL: z.string().optional().default(''),
  SMS_HTTP_METHOD: z.enum(['GET', 'POST']).default('POST'),
  SMS_HTTP_HEADERS: z.string().default('{}'),
  SMS_HTTP_BODY: z.string().default(''),
  SMS_HTTP_FROM: z.string().optional().default(''),
  SMS_HTTP_ID_PATH: z.string().default('id'),
  SMS_WEBHOOK_TOKEN: z.string().optional().default(''),
  CLIENT_DIST: z.string().default('../client/dist'),
  // Website media. Cloudinary is optional: without it, uploads are stored on this server.
  CLOUDINARY_CLOUD_NAME: z.string().regex(/^[a-z0-9_-]*$/i).optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  CLOUDINARY_FOLDER: z.string().regex(/^[A-Za-z0-9_\-/]*$/).optional().default(''),
  WEBSITE_IMAGE_MAX_MB: z.coerce.number().min(1).max(25).default(8),
  WEBSITE_VIDEO_MAX_MB: z.coerce.number().min(1).max(500).default(100),
  // v1.2 — WhatsApp Business Cloud API (Meta). Optional; can also be entered in the dashboard (encrypted).
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d*$/).optional().default(''),
  WHATSAPP_APP_SECRET: z.string().optional().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
  WHATSAPP_TEMPLATE_NAME: z.string().optional().default(''),
  WHATSAPP_TEMPLATE_LANGUAGE: z.string().default('en'),
  WHATSAPP_API_VERSION: z.string().regex(/^v\d{2}\.\d$/).default('v21.0'),
  // v1.2 — online fee payments. Optional; can also be entered in the dashboard (encrypted).
  PAYMENT_PROVIDER: z.enum(['none', 'stripe']).default('none'),
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  PAYMENT_CURRENCY: z.string().regex(/^[a-zA-Z]{3}$/).default('pkr')
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    // Fail fast: never run with a half-configured school installation.
    throw new Error(`Invalid environment configuration:\n${msg}`);
  }
  const env = parsed.data;
  if (env.APP_MODE === 'hybrid' && (!env.ATLAS_SYNC_URI || !env.ATLAS_SYNC_DB_NAME)) {
    throw new Error('APP_MODE=hybrid requires ATLAS_SYNC_URI and ATLAS_SYNC_DB_NAME');
  }
  const cloud = [env.CLOUDINARY_CLOUD_NAME, env.CLOUDINARY_API_KEY, env.CLOUDINARY_API_SECRET].filter(Boolean).length;
  if (cloud !== 0 && cloud !== 3) throw new Error('Cloudinary needs CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET together (or none of them)');
  if (env.APP_MODE === 'cloud' && !env.MONGODB_URI.startsWith('mongodb+srv://') && env.NODE_ENV === 'production') {
    // Allowed (self-hosted replica sets exist) but worth flagging.
    console.warn('[env] APP_MODE=cloud with a non-SRV URI; make sure this is the school\'s Atlas cluster.');
  }
  return env;
}

export const env = load();
export const isTest = env.NODE_ENV === 'test';
export const APP_VERSION = '1.0.0';
