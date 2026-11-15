/**
 * Hero editor layout: the live preview must never cover the editor panel or the Media Library dialog.
 * Regression for the Media Library opening *under* the preview column (the dialog was trapped in the
 * sticky editor panel's stacking context). Checked at desktop, laptop, tablet and phone widths.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

const PW = 'E2e-Password-1';
const WIDTHS = [
  { w: 1920, h: 1080 },
  { w: 1366, h: 768 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
  { w: 390, h: 844 },
];

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('principal');
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

/** The element actually hit at the control's centre is the control itself (nothing paints over it). */
async function expectOnTop(loc: Locator) {
  await loc.scrollIntoViewIfNeeded();
  await expect(loc).toBeVisible();
  const onTop = await loc.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && (hit === el || el.contains(hit)));
  });
  expect(onTop, 'control is covered by another element').toBe(true);
}

for (const vp of WIDTHS) {
  test(`hero editor at ${vp.w}px: preview never overlaps the editor or the Media Library`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await signIn(page);
    await page.goto('/admin/website/hero');
    await expect(page.getByRole('heading', { level: 1, name: 'Hero & banners' })).toBeVisible();

    const previewCard = page.locator('div.card', { has: page.locator('iframe[title="Page preview"]') }).first();
    await expect(previewCard).toBeVisible();
    // Device-size controls of the preview are still there.
    await expect(page.getByRole('group', { name: 'Preview size' }).getByRole('button')).toHaveCount(3);

    // Open the first slide and make sure it has a media background so the media pickers show.
    const slide = page.locator('button[aria-expanded]').first();
    if ((await slide.getAttribute('aria-expanded')) !== 'true') await slide.click();
    const bg = page.getByLabel('Background').first();
    if ((await bg.inputValue()) === 'none') await bg.selectOption('image');

    const choose = page.getByRole('button', { name: /^(Choose or upload|Change)$/ }).first();
    await expectOnTop(choose);

    // Editor and preview panels do not intersect.
    const editorCard = page.locator('div.card', { has: choose }).first();
    const a = (await editorCard.boundingBox())!;
    const b = (await previewCard.boundingBox())!;
    const intersects = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(intersects, `editor ${JSON.stringify(a)} overlaps preview ${JSON.stringify(b)}`).toBe(false);

    // Media Library opens above everything and all its controls are reachable.
    await choose.click();
    const dialog = page.getByRole('dialog', { name: 'Media library' });
    await expect(dialog).toBeVisible();
    await expectOnTop(dialog.getByRole('heading', { name: 'Media library' }));
    await expectOnTop(dialog.getByRole('button', { name: 'Add from URL' }));
    await expectOnTop(dialog.getByRole('button', { name: 'Upload' }));
    await expectOnTop(dialog.getByRole('button', { name: 'Close' }));
    const details = dialog.getByRole('button', { name: 'Details' });
    if (await details.count()) await expectOnTop(details.first());

    // Nested dialog (Add from URL) also opens on top, then everything closes cleanly.
    await dialog.getByRole('button', { name: 'Add from URL' }).click();
    const urlDialog = page.getByRole('dialog', { name: 'Add media from a URL' });
    await expectOnTop(urlDialog.getByRole('button', { name: 'Cancel' }));
    await urlDialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);

    // No horizontal page scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}
