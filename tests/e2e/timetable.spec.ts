/**
 * Timetable end to end in a real browser against the real server (DEMO school from start-e2e-server.mts):
 * set up timings, subjects, teacher profile and weekly periods → generate → drag-edit → publish →
 * teacher portal → student portal account → student portal. Also checks layout at several widths.
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

async function signIn(page: Page, username: string, password = PW, path = '/login', expectSuccess = true) {
  await page.goto(path);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (expectSuccess) await expect(page).not.toHaveURL(/\/login/);
}
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test.describe.configure({ mode: 'serial' });

test('principal sets up, generates, edits and publishes a timetable', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page, 'principal');
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole('link', { name: 'Timetable' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Timetable' })).toBeVisible();
  await expect(page.getByText('School timings are not set')).toBeVisible();

  // 1. School timings (the suggested bell schedule: 7 periods + lunch).
  await page.getByRole('tab', { name: 'School timings' }).click();
  await expect(page.getByText('Timings are not saved for this session yet')).toBeVisible();
  await page.getByRole('button', { name: 'Save school timings' }).click();
  await expect(page.getByText('School timings saved.')).toBeVisible();

  // 2. Subjects.
  await page.getByRole('tab', { name: 'Subjects & rooms' }).click();
  for (const name of ['Mathematics', 'English']) {
    await page.getByRole('button', { name: 'Add subject' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add subject' });
    await dlg.getByLabel('Name').fill(name);
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Subject saved.')).toBeVisible();
    await expect(page.getByRole('cell', { name })).toBeVisible();
  }

  // 3. Teacher profile: subjects.
  await page.getByRole('tab', { name: 'Teachers' }).click();
  await page.getByRole('row', { name: /DEMO Teacher/ }).getByRole('button', { name: 'Edit' }).click();
  const tdlg = page.getByRole('dialog', { name: 'DEMO Teacher' });
  await tdlg.getByLabel('Mathematics').check();
  await tdlg.getByLabel('English').check();
  await tdlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Teacher profile saved.')).toBeVisible();

  // 4. Weekly periods for DEMO 5-A.
  await page.getByRole('tab', { name: 'Weekly periods' }).click();
  await page.getByRole('button', { name: 'Add subject' }).click();
  await page.getByRole('button', { name: 'Add subject' }).click();
  const rows = page.locator('tbody tr');
  // New rows take the next unused subject (alphabetical), and a subject used in one row is disabled in the others.
  await expect(rows.nth(0).getByLabel('Subject')).toHaveValue(/.+/);
  await expect(rows.nth(1).getByLabel('Subject').locator('option', { hasText: 'English' })).toBeDisabled();
  await rows.nth(0).getByLabel('Subject').selectOption({ label: 'English' });
  await rows.nth(0).getByLabel('Periods / week').fill('4');
  await rows.nth(1).getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await rows.nth(1).getByLabel('Periods / week').fill('5');
  await page.getByRole('button', { name: 'Save weekly periods' }).click();
  await expect(page.getByText('Weekly periods saved.')).toBeVisible();

  // 5. Generate.
  await page.getByRole('tab', { name: 'Timetable' }).click();
  await page.getByRole('button', { name: 'Generate' }).click();
  const gen = page.getByRole('dialog', { name: 'Generate timetable automatically' });
  await gen.getByRole('button', { name: 'Generate' }).click();
  await expect(gen.getByText('Complete timetable found')).toBeVisible({ timeout: 30_000 });
  await expect(gen.getByText('9 / 9 lessons placed')).toBeVisible();
  await gen.getByText('Close', { exact: true }).click();
  const grid = page.locator('.print-area table');
  await expect(grid.getByRole('button', { name: /Mathematics/ })).toHaveCount(5);
  await expect(grid.getByRole('button', { name: /English/ })).toHaveCount(4);
  await expect(page.getByText('0 conflicts · 0 warnings')).toBeVisible();

  // 6. Drag a lesson to an empty period (warnings, if any, are confirmed explicitly).
  const lessonBtn = grid.getByRole('button', { name: /English/ }).first();
  const empty = grid.getByRole('button', { name: /: add lesson$/ }).first();
  await lessonBtn.dragTo(empty);
  const confirm = page.getByRole('dialog', { name: 'Please confirm' });
  // Either the move is saved straight away, or the server asks to confirm a warning first: wait for whichever comes.
  await expect(page.getByText('Lesson moved.').or(confirm)).toBeVisible();
  if (await confirm.isVisible()) await confirm.getByRole('button', { name: 'Save anyway' }).click();
  await expect(page.getByText('Lesson moved.')).toBeVisible();
  await expect(grid.getByRole('button', { name: /English/ })).toHaveCount(4);

  // 7. Add a lesson in a break? Not possible: breaks have no "add" button. Add one in a free period via the dialog.
  await grid.getByRole('button', { name: /: add lesson$/ }).first().click();
  const add = page.getByRole('dialog', { name: 'Add lesson' });
  await add.getByLabel('Subject').selectOption({ label: 'Mathematics' });
  await add.getByLabel('Teacher').selectOption({ label: '✓ DEMO Teacher' });
  await expect(add.getByText('Saving will cause:')).toBeVisible(); // 6 of 5 weekly maths periods
  await add.getByRole('button', { name: 'Save anyway' }).click();
  await expect(page.getByText('Lesson added.')).toBeVisible();
  await expect(grid.getByRole('button', { name: /Mathematics/ })).toHaveCount(6);
  // Remove it again (warning confirmed in the dialog).
  await grid.getByRole('button', { name: /Mathematics/ }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  const c2 = page.getByRole('dialog', { name: 'Please confirm' });
  await expect(page.getByText('Lesson removed.').or(c2)).toBeVisible();
  if (await c2.isVisible()) await c2.getByRole('button', { name: 'Save anyway' }).click();
  await expect(page.getByText('Lesson removed.')).toBeVisible();

  // 8. Publish.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const pub = page.getByRole('dialog', { name: 'Publish timetable' });
  const ack = pub.getByLabel('I have reviewed the warnings; publish anyway');
  if (await ack.isVisible().catch(() => false)) await ack.check();
  await pub.getByRole('button', { name: 'Publish now' }).click();
  await expect(pub.getByText(/Published 9 lessons/)).toBeVisible();
  await pub.getByText('Close', { exact: true }).click();
  await expect(page.getByText(/^Published /).first()).toBeVisible();

  // Layout: the board never makes the page scroll sideways (the grid scrolls inside its own panel).
  for (const width of [1920, 1366, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { level: 1, name: 'Timetable' })).toBeVisible();
    expect(await noHorizontalScroll(page), `width ${width}`).toBe(true);
  }
});

test('teacher sees their own published timetable', async ({ page }) => {
  await signIn(page, 'teacher');
  await page.getByRole('link', { name: 'My timetable' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My timetable' })).toBeVisible();
  await expect(page.getByText('Lessons per week')).toBeVisible();
  await expect(page.locator('.print-area').getByText('DEMO 5-A').first()).toBeVisible();
  await expect(page.locator('.print-area').getByText('Mathematics').first()).toBeVisible();
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Today/ })).toBeVisible();
});

test('student portal account: sign in and see only the class timetable', async ({ page, browser }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/students');
  await page.getByRole('link', { name: 'DEMO Ali' }).click();
  await page.getByRole('button', { name: 'Create portal account' }).click();
  const dlg = page.getByRole('dialog', { name: /Create portal account/ });
  await dlg.getByLabel('Username').fill('ali.student');
  await dlg.getByRole('button', { name: 'Create' }).click();
  const pw = (await dlg.locator('code').nth(1).textContent())!.trim();
  expect(pw).toMatch(/^[A-Za-z0-9]{14}$/);

  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await sp.setViewportSize({ width: 390, height: 844 });
  // A student cannot use the staff sign-in page.
  await signIn(sp, 'ali.student', pw, '/login', false);
  await expect(sp.getByRole('alert')).toBeVisible();
  await expect(sp).toHaveURL(/\/login/);
  await signIn(sp, 'ali.student', pw, '/student/login');
  await expect(sp).toHaveURL(/\/student$/);
  // The portal opens on the student's home page; the timetable has its own page.
  await expect(sp.getByRole('heading', { level: 1, name: /Welcome, DEMO/ })).toBeVisible();
  await sp.goto('/student/timetable');
  await expect(sp.getByRole('heading', { level: 1, name: 'My class timetable' })).toBeVisible();
  // Phones open on the Day view (today only); the week view shows every lesson.
  await expect(sp.getByRole('tab', { name: /Today/ })).toBeVisible();
  await sp.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(sp.locator('.print-area').getByText('Mathematics')).toHaveCount(5);
  await expect(sp.locator('.print-area').getByText('English')).toHaveCount(4);
  expect(await noHorizontalScroll(sp)).toBe(true);
  // The student is kept out of the staff dashboard.
  await sp.goto('/admin/timetable');
  await expect(sp).toHaveURL(/\/student$/);
  await ctx.close();
});
