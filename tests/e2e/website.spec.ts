/**
 * Website Management end to end, in a real browser against the real server and database
 * (DEMO school from start-e2e-server.mts). Runs after workflows.spec.ts (alphabetical, one worker).
 * Covers: page builder save → draft preview → publish → public page, Arabic-script/RTL language URL,
 * hero rendering, inner pages, responsive widths without horizontal overflow, and SEO tags.
 */
import { expect, test, type Page } from '@playwright/test';

const PW = 'E2e-Password-1';
const problems: string[] = [];
test.beforeEach(({ page }) => {
  problems.length = 0;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
});
test.afterEach(() => { expect(problems, problems.join('\n')).toEqual([]); });

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('principal');
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}
async function enableWebsite(page: Page) {
  await page.goto('/admin/website/settings');
  const box = page.getByLabel('Publish the public school website');
  if (!(await box.isChecked())) { await box.check(); await page.getByRole('button', { name: 'Save' }).click(); await expect(page.getByText('Saved', { exact: true })).toBeVisible(); }
}

test('every Website Management screen opens', async ({ page }) => {
  await signIn(page);
  for (const path of ['', 'builder', 'pages', 'navigation', 'hero', 'sections', 'media', 'about', 'academics', 'admissions', 'faculty', 'campus', 'student-life', 'news', 'gallery', 'testimonials', 'faqs', 'contact', 'footer', 'theme', 'languages', 'seo', 'publishing', 'revisions', 'settings']) {
    await page.goto(`/admin/website/${path}`);
    await expect(page.getByRole('navigation', { name: 'Website Management' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('page builder: edit → save draft → preview → publish → public; unpublished pages stay private', async ({ page, context }) => {
  await signIn(page);
  await enableWebsite(page);
  await page.goto('/site/about-us');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible(); // starter page is a draft

  await page.goto('/admin/website/pages');
  await page.getByRole('link', { name: 'Edit' }).nth(1).click(); // About Us
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About Us');
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click(); // page header section
  await page.getByLabel('Page heading').fill('About DEMO E2E School');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  // Live preview frame shows the unsaved text.
  await expect(page.frameLocator('iframe[title="Page preview"]').getByRole('heading', { name: 'About DEMO E2E School' })).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  // Saved draft: visible in the authenticated preview, still 404 for the public.
  const preview = await context.newPage();
  await preview.goto('/site/about-us?preview=1');
  await expect(preview.getByRole('heading', { name: 'About DEMO E2E School' })).toBeVisible();
  const anon = await (await context.browser()!.newContext()).newPage();
  await anon.goto('http://127.0.0.1:8099/site/about-us');
  await expect(anon.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await anon.goto('http://127.0.0.1:8099/site/about-us?preview=1');
  await expect(anon.getByRole('heading', { name: 'About DEMO E2E School' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Published. The page is now live.')).toBeVisible();
  await anon.goto('http://127.0.0.1:8099/site/about-us');
  await expect(anon.getByRole('heading', { level: 1, name: 'About DEMO E2E School' })).toBeVisible();
  // The page survives a reload in the builder (persisted, not local state).
  await page.reload();
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByLabel('Page heading')).toHaveValue('About DEMO E2E School');
  await anon.context().close();
});

test('public site: hero, language switch with RTL, contact form, SEO head', async ({ page }) => {
  await signIn(page);
  await enableWebsite(page);
  await page.context().clearCookies();
  const res = await page.goto('/site');
  expect(res!.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('DEMO E2E School');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(await page.locator('link[rel="canonical"]').getAttribute('href')).toBe('http://127.0.0.1:8099/site');
  expect(await page.locator('link[hreflang="ur"]').getAttribute('href')).toBe('http://127.0.0.1:8099/site/ur');

  await page.getByRole('group', { name: 'Language' }).first().getByRole('link', { name: 'اردو' }).click();
  await expect(page).toHaveURL(/\/site\/ur$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ur');

  await page.goto('/site/contact-us');
  await page.getByLabel('Your name').fill('DEMO Visitor');
  await page.getByLabel('Phone number').fill('0300 1112233');
  await page.getByLabel('Message').fill('Please call me back.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('Your message has been received')).toBeVisible();

  expect((await page.goto('/site/no-such-page'))!.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  expect((await page.request.get('/sitemap.xml')).status()).toBe(200);
});

for (const width of [360, 390, 430, 768, 1024, 1280, 1440, 1920]) {
  test(`public site has no horizontal overflow at ${width}px (English and Urdu)`, async ({ page }) => {
    await signIn(page);
    await enableWebsite(page);
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/site', '/site/ur', '/site/news', '/site/contact-us', '/site/ur/contact-us']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} @ ${width}`).toBeLessThanOrEqual(1);
    }
  });
}
