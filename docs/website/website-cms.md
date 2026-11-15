# Public website and Website Management (CMS)

Added in the "website CMS" upgrade on top of v1.0.0. Read **Verification status** before relying on it.

## What it is

- **Public website** at `/site`: a themed, responsive, bilingual (English / Urdu, RTL) school website
  rendered entirely from CMS content. Home page plus inner pages, news / event / gallery detail pages,
  contact and admission-inquiry forms.
- **Website Management** in the Admin Dashboard (`/admin/website`): pages and a page builder with live
  preview, hero slides, media library, content collections, navigation, footer, contact details, theme,
  languages, SEO, domain, drafts, publishing and revision history.

It replaces the old single-screen "Public website" page. The old settings (`website.enabled`,
hero title/subtitle/about, announcements) are kept: they seed the new home page, the switch still turns
the site on and off, and announcements are managed under **News & events → Announcements**.

## Architecture (how it fits the existing system)

| Layer | Files |
|---|---|
| Shared validation + logic | `shared/src/schemas/website.ts`, `shared/src/logic/website.ts`, `shared/src/logic/website-defaults.ts` |
| Models (new collections only) | `server/src/models/website.ts` |
| Domain logic | `server/src/services/website.ts`, `website-seo.ts`, `cloudinary.ts`, additions to `uploads.ts` |
| Dashboard API | `server/src/modules/website.routes.ts` → `/api/website/*` (session + CSRF + permissions) |
| Public API | `server/src/modules/website-public.routes.ts` → `/api/public/site/*` (published content only) |
| Public site | `client/src/public/PublicSite.tsx`, `client/src/public/site/*`, `client/src/public/site.css` |
| Dashboard | `client/src/admin/cms/*` |

No existing model, route, permission or workflow was removed. Nothing in the existing collections is
modified: the module only **adds** six collections.

### Database (additive)

| Collection | Purpose |
|---|---|
| `websiteconfig` | Singleton `_id: "site"`: site-wide configuration with separate `draft` and `published` copies; custom domain |
| `websitepages` | Pages: `slug`, `draft`, `published`, status, schedule |
| `websiteitems` | News, events, faculty, testimonials, FAQs, programmes, facilities, activities, achievements, albums |
| `websitemedia` | Media library records (local uploads, Cloudinary, YouTube / Vimeo) |
| `websiterevisions` | Snapshot on every publish / restore (last 30 per page and for the site) |
| `websiteinquiries` | Messages from the public contact / admission forms |

All six use the existing versioned-write layer (`services/repo.ts`), so they take part in hybrid
synchronisation and in backups like every other collection. No migration is needed: the collections and
their indexes are created on first use. **Rollback**: deploy the previous version; the six collections
are simply ignored (drop them only if you want the space back).

The first time the module is used it creates the site configuration and 23 starter pages
(`ensureWebsite()`), reading the school profile but never writing to it.
- **Published at first use**: Home, News and Contact, built only from the school's own data
  (name, description, existing website text, contact details, announcements).
- **Drafts**: every other page, with clearly marked sample text for the school to replace.
- Statistics are never invented: a figure is either typed by the school or a live count of the
  school's own active students / teachers / classes. The starter statistics section is draft-only.

### Draft / publish

Pages and the site configuration each hold a `draft` and a `published` copy. The public API reads only
`published`. Collection entries have a status (`draft` / `published`). Authenticated editors preview drafts
through `/api/website/preview/*` (`/site/...?preview=1`); the page builder's frame shows *unsaved*
content, validated by the server, without storing it. "Restore" copies an old version into the draft;
nothing changes publicly until that draft is published.

### Roles and school isolation

- `website.manage`: edit drafts, content, media. `website.publish` (new): publish, unpublish, delete,
  restore, replace media, domain. Principal and Admin have both; other users can be granted either
  under **Staff & users**. Enforced in the API, not only hidden in the UI.
- This product is deployed as **one installation per school** (own database, guarded by
  `SCHOOL_INSTALL_ID`). Website content therefore lives in that school's own database and cannot be
  reached from another school's installation. The system was **not** converted to a multi-tenant
  database: that would require restructuring every existing model and was explicitly declined.

### Media

- **Upload from the computer** → stored under `UPLOAD_DIR/website` with a server-generated name; the
  real type is detected from the file content (PNG, JPEG, WebP, MP4, WebM), size limits are enforced
  on the server (`WEBSITE_IMAGE_MAX_MB`, `WEBSITE_VIDEO_MAX_MB`).
- **Cloudinary** (optional): with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
  set, uploads go from the browser straight to Cloudinary using a signature generated on the server;
  the secret never reaches the browser. Pasted Cloudinary URLs work with or without these settings.
- **YouTube / Vimeo** links are stored as official embeds (click-to-load). They cannot be used as hero
  backgrounds (a muted autoplay background needs a video file).
- URLs are validated against an allow-list and **never fetched by the server** (no SSRF surface). The
  Content-Security-Policy only allows media from this server, `res.cloudinary.com`, and the official
  YouTube / Vimeo / Google Maps embed hosts.
- Deleting is refused while a file is referenced; replacing a file repoints every reference.

### Hero playback

One timer, owned by one effect. Image slides use the CMS duration. Video slides advance when the video
ends unless "move on after the duration" is enabled. A video that cannot play falls back to its poster
and the timer. Rotation pauses while the tab is hidden and is off under `prefers-reduced-motion`
(arrows and indicators still work). Posters are not slides. Phones show the poster instead of
downloading a desktop video unless a mobile video is assigned.

### SEO

For every `/site` URL the server injects title, description, robots, canonical, `hreflang` alternates,
Open Graph tags and JSON-LD into the HTML shell, and returns a real 404 status for pages that do not
exist or are not published. `/sitemap.xml` and `/robots.txt` are generated from published content.
Structured data contains only what the school entered.

### Typography

Fonts are system font stacks chosen from a controlled list (no web-font download: the app must also
work on offline / LAN installs and the CSP forbids third-party font hosts). Urdu uses a Nastaliq stack.

### Custom domain

Website Management → Domain & publishing stores the domain and verifies ownership with a DNS TXT
record. It does **not** create DNS records or TLS certificates. To serve the site on the domain:
1. Add the TXT record shown on the screen and click **Verify now**.
2. Point the domain (CNAME / A record) at the server or reverse proxy.
3. Terminate HTTPS for that domain at the proxy / hosting platform.
4. Add `https://<domain>` to `CORS_ORIGINS`.
Once verified, canonical links, the sitemap and Open Graph URLs use the domain.

## Run it

```bash
# 1. Extract and install (Node 20.11+)
unzip school-management-system-v1.0.0-website-cms.zip
cd school-management-system-v1.0.0/school-management-system
npm install                       # also builds shared/

# 2. Environment: reuse your existing server/.env. New optional keys are in .env.example
#    (CLOUDINARY_*, WEBSITE_IMAGE_MAX_MB, WEBSITE_VIDEO_MAX_MB). A new database also needs:
#    npm run init:school

# 3. Development (API :8080, Vite :5173)
npm run dev
#    or production
npm run build && cd server && NODE_ENV=production node dist/index.js
```

- Admin Dashboard: `http://localhost:5173/login` (dev) or `http://localhost:8080/login` → sign in with
  your existing Principal account.
- Website Management: left menu → **Website Management** (`/admin/website`).
- Switch the website on: Website Management → **Website settings** → "Publish the public school website".
- Public website: `/site` (Urdu: `/site/ur`). Draft preview: **Preview draft** buttons (`?preview=1`).

Checks:

```bash
npm run typecheck
npm test                          # shared logic + server (in-memory MongoDB) + client
npx playwright install chromium && npm run test:e2e
```

## Verification status

The upgrade was written in a sandbox **without a MongoDB server, without internet access, and with
`node_modules` that had been installed on Windows** (no Linux binaries for Vite / esbuild / Rollup).

| Check | Result |
|---|---|
| `tsc --noEmit` for shared, server (including all test files) and client | **Passed** |
| Shared logic tests (`node --test`, 63 tests: validation, media URL rules, hero timing, routing, theme tokens, starter content) | **Passed** |
| `scripts/verify-syntax.mjs`, `scripts/gen-api-docs.mjs --check` | **Passed** |
| Client bundled with a standalone esbuild + Tailwind and rendered in headless Chromium against a mock API built from the real shared schemas: public site (English and Urdu) and the CMS screens, 360–1920 px | **Reviewed** (see report for what was checked) |
| Server integration tests `server/tests/website.test.ts` (and the existing 106 server tests) | **Written, NOT RUN** (need MongoDB) |
| Client tests `client/src/public/site/site.test.tsx` (and the existing client tests) | **Written, NOT RUN** (Vitest needs the platform binaries) |
| Playwright `tests/e2e/website.spec.ts` and the updated `workflows.spec.ts` | **Written, NOT RUN** |
| `vite build` | **NOT RUN** |
| Real Cloudinary upload | **NOT RUN** (no account). The signature function matches Cloudinary's documented example |
| DNS verification of a real domain | **NOT RUN** |
| Uploads end to end, publishing end to end against a real database | **NOT RUN** |

Run `npm run typecheck && npm test && npm run test:e2e` after installing. Treat any failure as a
defect in this upgrade and report it.

## Known limitations

- Local uploads are files on the server that received them. In hybrid mode (local + Atlas) the media
  *records* synchronise but the files do not; use Cloudinary if the site is served from another node.
- Uploaded images are served as stored (no server-side resizing; no image library was added). Cloudinary
  images get automatic format, quality and responsive sizes. Upload reasonably sized images (≤ 2560 px wide).
- Collection entries (news, events …) are draft *or* published, not both at once: editing a published
  entry changes it live. Pages and site settings have full draft / publish separation and history.
- The dashboard's CMS screens are in English with Urdu for navigation and the main actions; the public
  website interface is fully English / Urdu.
- Sample starter text is English only; the Language & translation report lists what needs translating.
- Scheduled publishing runs inside the server process (checked once a minute).
- No photographs are bundled. Hero and sections are designed to look complete without media, and
  better with the school's own photography.
