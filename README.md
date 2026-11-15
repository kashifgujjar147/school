# School Management System

One master codebase, installed **independently for each school** (not multi-tenant SaaS).
Every installation has its own database, credentials, principal account, branding and data.

- **Admin Dashboard** (principal/administrators): overview, students, classrooms & teacher assignments, users & permissions, attendance monitor, corrections, reports & exports, settings & branding, security center, system health, backups, sync, optional public website.
- **Teacher Portal**: assigned classrooms, fast attendance marking (Mark all present, per-student status), review & submit, history, correction requests — works offline.
- **Parent SMS alerts** (Standard package): guardians, templates (English/Urdu), queue with retries, real provider receipts (Twilio or a generic HTTP gateway).
- **v1.2**: **Parent Portal** (separate sign-in; one account sees all and only its linked children: attendance, published results and report cards, homework, fees and receipts, teacher feedback, announcements, events), **SMS + WhatsApp Business** notifications (absence, fee due/paid, results, homework, announcements) with honest delivery states, **fees** with vouchers, cash/bank payments and **verified online payment** (Stripe Checkout), **student ID cards** with secure QR verification, and an **analytics** dashboard built from live records. Setup: [`docs/features/v1.2-features.md`](docs/features/v1.2-features.md).
- **English + Urdu** with full RTL layout.
- **Public website + Website Management (CMS)**: page builder with live preview, hero slides, media library (uploads, Cloudinary, YouTube/Vimeo), news/events/gallery, theme, SEO, drafts, publishing and revision history. See [`docs/website/website-cms.md`](docs/website/website-cms.md) — including its **verification status**.
- **Online, offline single-computer, offline LAN, and hybrid (local + Atlas sync)** operation.

> **Verification status — read [`docs/AUDIT-REPORT.md`](docs/AUDIT-REPORT.md)** (2026-11-12 full-stack audit:
> type-check, build, 23 logic + 106 server + 18 client tests and 21 Playwright e2e tests, all passing against
> in-memory MongoDB). [`docs/TEST-REPORT.md`](docs/TEST-REPORT.md) is the original pre-install report.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, Zustand, React Hook Form, Zod, Recharts, Dexie (IndexedDB), hand-written Service Worker (PWA) |
| Backend | Node.js ≥ 20.11, TypeScript, Express, Mongoose, Zod, Helmet, express-rate-limit, Pino, ExcelJS, PDFKit |
| Database | **MongoDB Atlas** (online) · **MongoDB Community** (local/offline/LAN) — same document model |
| Tests | Vitest, Supertest, mongodb-memory-server, React Testing Library, fake-indexeddb, Playwright |

No Docker. Conventional Node.js deployment.

## Repository layout

```
shared/   types, Zod schemas, permission matrix, pure logic (sync decisions, attendance maths, SMS templates)
server/   Express API, Mongoose models, sync engine, SMS worker, backups, scripts (init/seed/backup/migrate)
client/   React app: admin/, teacher/, public/ website, offline/ (IndexedDB), sync/ (outbox), i18n/ (en, ur)
docs/     architecture, installation (online/offline/LAN/hybrid/onboarding/updates/backups), sync, security, API
tests/e2e Playwright end-to-end tests (incl. offline → online sync)
scripts/  verify-syntax, gen-api-docs, package-zip
```

## First run on your machine (development)

```bash
# 1. Node 20.11+ and a MongoDB you can reach (local `mongod`, or an Atlas dev cluster)
npm install                      # also builds shared/ (postinstall)
cp .env.example server/.env      # edit: APP_MODE, MONGODB_URI, MONGODB_DB_NAME, SCHOOL_INSTALL_ID, NODE_ID, secrets
npm run init:school              # creates settings + principal; prints the one-time principal password
npm run seed:demo                # optional DEMO / SAMPLE DATA (clearly prefixed "DEMO")
npm run dev                      # API on :8080, Vite on :5173 (proxy to API)
```

Verify the build and tests:

```bash
npm run typecheck
npm run build
npm test                         # shared logic + server (in-memory MongoDB) + client tests
npx playwright install chromium && npm run test:e2e
```

## Production

```bash
npm ci && npm run build
cd server && NODE_ENV=production node dist/index.js     # serves API + built client on one port
```

See the installation guides:

- [Online (MongoDB Atlas)](docs/installation/online.md)
- [Offline single computer](docs/installation/offline-single-computer.md)
- [Offline LAN](docs/installation/offline-lan.md)
- [Hybrid: local + Atlas sync](docs/installation/hybrid.md)
- [School onboarding (new independent installation)](docs/installation/school-onboarding.md)
- [Updates, migrations & rollback](docs/installation/updates-and-rollback.md)
- [Backup & recovery](docs/installation/backup-and-recovery.md)

Design docs: [architecture](docs/architecture/overview.md) · [database](docs/architecture/database.md) ·
[browser offline](docs/offline/browser-offline.md) · [synchronisation](docs/synchronization/synchronization.md) ·
[security](docs/security/security.md) · [API reference](docs/api/endpoints.md)

## Packages

| | Starter | Standard |
|---|---|---|
| Students, classrooms, teachers, assignments, attendance, corrections, reports, backups, online/offline/LAN | ✓ | ✓ |
| Guardians, automatic SMS alerts, templates, provider integration, delivery reports, retries | — | ✓ |

The package is set per installation by `PACKAGE=starter|standard` in the server environment and enforced
in the backend (`requireFeature`, permission stripping) as well as hidden in the UI.
