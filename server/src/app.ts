import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import express, { Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env, isTest } from './config/env.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFound } from './utils/http.js';
import { attachUser, csrfProtect, parentFence, requireAuth } from './middleware/auth.js';
import { uploadDir } from './services/uploads.js';
import { authRouter } from './modules/auth.routes.js';
import { usersRouter } from './modules/users.routes.js';
import { publicRouter, settingsRouter } from './modules/settings.routes.js';
import { academicRouter } from './modules/academic.routes.js';
import { studentsRouter } from './modules/students.routes.js';
import { guardiansRouter } from './modules/guardians.routes.js';
import { attendanceRouter } from './modules/attendance.routes.js';
import { reportsRouter } from './modules/reports.routes.js';
import { smsRouter, smsWebhookRouter, whatsappWebhookRouter } from './modules/sms.routes.js';
import { parentRouter } from './modules/parent.routes.js';
import { studentAccountsRouter, studentRouter } from './modules/student.routes.js';
import { timetableRouter } from './modules/timetable.routes.js';
import { feesRouter, paymentWebhookRouter } from './modules/fees.routes.js';
import { examsRouter, feedbackRouter, homeworkRouter } from './modules/academics.routes.js';
import { idCardsRouter, verifyPageRouter, verifyRouter } from './modules/idcards.routes.js';
import { analyticsRouter } from './modules/analytics.routes.js';
import { backupsRouter } from './modules/backups.routes.js';
import { healthRouter, systemRouter } from './modules/system.routes.js';
import { idempotent } from './middleware/idempotency.js';
import { websiteRouter } from './modules/website.routes.js';
import { publicSiteRouter } from './modules/website-public.routes.js';
import { injectHead, renderSiteHead, robotsTxt, sitemapXml } from './services/website-seo.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);

  // LAN installs serve over plain HTTP, so HSTS / upgrade-insecure-requests are only enabled with secure cookies.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"],
        'script-src': ["'self'"], 'worker-src': ["'self'"], 'manifest-src': ["'self'"],
        // Website media: Cloudinary delivery + direct signed uploads, and the official YouTube / Vimeo /
        // Google Maps embeds. Nothing else can be loaded, whatever an editor pastes into the CMS.
        'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
        'media-src': ["'self'", 'blob:', 'https://res.cloudinary.com'],
        'frame-src': ["'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.google.com'],
        'connect-src': ["'self'", 'https://api.cloudinary.com'],
        'upgrade-insecure-requests': env.COOKIE_SECURE ? [] : null
      }
    },
    hsts: env.COOKIE_SECURE,
    crossOriginEmbedderPolicy: false
  }));
  const origins = [env.APP_URL, ...env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)];
  app.use(cors({ origin: (o, cb) => cb(null, !o || origins.includes(o)), credentials: true }));
  app.use(compression());
  if (!isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  app.use(cookieParser());
  // rawBody is kept for payment / WhatsApp webhooks, whose signatures are computed over the exact bytes.
  app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = buf; } }));

  const api = Router();
  api.use(rateLimit({ windowMs: 60_000, limit: isTest ? 100_000 : 600, standardHeaders: 'draft-7', legacyHeaders: false }));
  api.use('/health', healthRouter);
  api.use('/public/site', publicSiteRouter);
  api.use('/public', publicRouter);
  api.use('/webhooks/sms', smsWebhookRouter);
  // v1.2 public endpoints: each verifies its own signature / token and is rate-limited.
  api.use('/webhooks/whatsapp', whatsappWebhookRouter);
  api.use('/webhooks/payments', paymentWebhookRouter);
  api.use('/public/verify', verifyRouter);
  api.use(attachUser);
  api.use('/auth', csrfProtect, authRouter);
  api.use(requireAuth, csrfProtect, parentFence);
  // Offline outbox: any change a device queued without internet is re-sent with its Idempotency-Key.
  // When a key was already processed (the response was lost on the way back), the stored response is
  // replayed instead of applying the change twice. Requests without the header are unaffected.
  api.use((req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? next() : idempotent(false)(req, res, next)));
  api.use('/parent', parentRouter);
  api.use('/student', studentRouter);
  api.use('/users', usersRouter);
  api.use('/settings', settingsRouter);
  api.use('/academic', academicRouter);
  api.use('/students', studentAccountsRouter, studentsRouter);
  api.use('/guardians', guardiansRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/reports', reportsRouter);
  api.use('/sms', smsRouter);
  api.use('/backups', backupsRouter);
  api.use('/system', systemRouter);
  api.use('/website', websiteRouter);
  api.use('/fees', feesRouter);
  api.use('/exams', examsRouter);
  api.use('/homework', homeworkRouter);
  api.use('/feedback', feedbackRouter);
  api.use('/id-cards', idCardsRouter);
  api.use('/analytics', analyticsRouter);
  api.use('/timetable', timetableRouter);
  api.use(() => { throw notFound('API endpoint not found'); });
  app.use('/api', api);

  // Search engines: generated from published website content only.
  app.get('/robots.txt', (_req, res, next) => { robotsTxt().then((t) => res.type('text/plain').set('Cache-Control', 'public, max-age=300').send(t), next); });
  app.get('/sitemap.xml', (_req, res, next) => {
    sitemapXml().then((xml) => (xml ? res.type('application/xml').set('Cache-Control', 'public, max-age=300').send(xml) : res.status(404).type('text/plain').send('Not found')), next);
  });

  app.use('/uploads', express.static(uploadDir, { fallthrough: false, maxAge: '7d', dotfiles: 'deny', index: false }));

  // Serve the built SPA (single origin: works the same in cloud, single-computer and LAN installs).
  const clientDist = path.resolve(process.cwd(), env.CLIENT_DIST);
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist, {
      index: false,
      setHeaders: (res, file) => {
        // The service worker and HTML must always revalidate so updates roll out.
        if (/(sw\.js|index\.html|manifest\.webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
        else if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }));
    const shell = path.join(clientDist, 'index.html');
    // Public website URLs get their real <title>, description, canonical, Open Graph and JSON-LD
    // injected into the shell, so crawlers and link previews see the page, not a blank app.
    app.get(/^\/site(\/.*)?$/, async (req, res, next) => {
      try {
        const head = await renderSiteHead(req.path.slice('/site'.length)).catch((err) => { logger.warn({ err }, 'site head rendering failed'); return null; });
        if (!head) return next();
        res.status(head.status).setHeader('Cache-Control', 'no-cache');
        res.type('html').send(injectHead(await readFile(shell, 'utf8'), head));
      } catch (e) { next(e); }
    });
    app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(shell); });
  } else {
    // API-only service (the web app is served elsewhere): a scanned ID-card QR code that points here
    // still gets a verification page, with the school logo from the bundled brand assets.
    app.use('/brand', express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/brand'), { maxAge: '7d', index: false }));
    app.use('/verify', verifyPageRouter);
  }

  app.use(errorHandler);
  return app;
}
