import path from 'node:path';
import { existsSync } from 'node:fs';
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
import { attachUser, csrfProtect, requireAuth } from './middleware/auth.js';
import { uploadDir } from './services/uploads.js';
import { authRouter } from './modules/auth.routes.js';
import { usersRouter } from './modules/users.routes.js';
import { publicRouter, settingsRouter } from './modules/settings.routes.js';
import { academicRouter } from './modules/academic.routes.js';
import { studentsRouter } from './modules/students.routes.js';
import { guardiansRouter } from './modules/guardians.routes.js';
import { attendanceRouter } from './modules/attendance.routes.js';
import { reportsRouter } from './modules/reports.routes.js';
import { smsRouter, smsWebhookRouter } from './modules/sms.routes.js';
import { backupsRouter } from './modules/backups.routes.js';
import { healthRouter, systemRouter } from './modules/system.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);

  // LAN installs serve over plain HTTP, so HSTS / upgrade-insecure-requests are only enabled with secure cookies.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"], 'img-src': ["'self'", 'data:', 'blob:'], 'style-src': ["'self'", "'unsafe-inline'"],
        'script-src': ["'self'"], 'connect-src': ["'self'"], 'worker-src': ["'self'"], 'manifest-src': ["'self'"],
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
  app.use(express.json({ limit: '2mb' }));

  const api = Router();
  api.use(rateLimit({ windowMs: 60_000, limit: isTest ? 100_000 : 600, standardHeaders: 'draft-7', legacyHeaders: false }));
  api.use('/health', healthRouter);
  api.use('/public', publicRouter);
  api.use('/webhooks/sms', smsWebhookRouter);
  api.use(attachUser);
  api.use('/auth', csrfProtect, authRouter);
  api.use(requireAuth, csrfProtect);
  api.use('/users', usersRouter);
  api.use('/settings', settingsRouter);
  api.use('/academic', academicRouter);
  api.use('/students', studentsRouter);
  api.use('/guardians', guardiansRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/reports', reportsRouter);
  api.use('/sms', smsRouter);
  api.use('/backups', backupsRouter);
  api.use('/system', systemRouter);
  api.use(() => { throw notFound('API endpoint not found'); });
  app.use('/api', api);

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
    app.get('*', (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(clientDist, 'index.html')); });
  }

  app.use(errorHandler);
  return app;
}
