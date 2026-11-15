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
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
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
  CLIENT_DIST: z.string().default('../client/dist')
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
  if (env.APP_MODE === 'cloud' && !env.MONGODB_URI.startsWith('mongodb+srv://') && env.NODE_ENV === 'production') {
    // Allowed (self-hosted replica sets exist) but worth flagging.
    console.warn('[env] APP_MODE=cloud with a non-SRV URI; make sure this is the school\'s Atlas cluster.');
  }
  return env;
}

export const env = load();
export const isTest = env.NODE_ENV === 'test';
export const APP_VERSION = '1.0.0';
