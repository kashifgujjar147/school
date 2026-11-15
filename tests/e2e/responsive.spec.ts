/**
 * Phone-sized viewport (Pixel 7, "mobile" project): teachers mark attendance on their phones.
 * Uses a date three days back so it never collides with the registers submitted by the other suites.
 */
import { expect, test, type Page } from '@playwright/test';

const PW = 'E2e-Password-1';
const problems: string[] = [];

test.beforeEach(({ page }) => {
  problems.length = 0;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
});
test.afterEach(() => { expect(problems, problems.join('\n')).toEqual([]); });

async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
/** No horizontal scrolling: the page must fit the phone's width. */
async function expectNoHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `page is ${scroll}px wide on a ${client}px screen`).toBeLessThanOrEqual(client);
}
const schoolDate = (daysBack: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date(Date.now() - daysBack * 86_400_000));

test('teacher marks a register on a phone; it is saved and shown as submitted', async ({ page }) => {
  await signIn(page, 'teacher');
  await expectNoHorizontalScroll(page);
  const rooms = (await (await page.request.get('/api/academic/classrooms?mine=true')).json()).data as { _id: string }[];
  const date = schoolDate(3);
  await page.goto(`/teacher/mark/${rooms[0]!._id}?date=${date}`);
  await expect(page.getByRole('button', { name: 'Mark all present' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Mark all present' }).click();
  await page.getByRole('radiogroup').first().getByRole('radio', { name: 'Late' }).click();
  await page.getByRole('button', { name: 'Review & submit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit attendance' }).click();
  await expect(page.getByText('Attendance submitted.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Attendance for this date is already submitted.')).toBeVisible();
  const history = (await (await page.request.get(`/api/attendance/history?from=${date}&to=${date}`)).json()).data as { counts: { late: number } }[];
  expect(history).toHaveLength(1);
  expect(history[0]!.counts.late).toBe(1);
});

test('admin pages fit a phone screen and the menu opens', async ({ page }) => {
  await signIn(page, 'principal');
  for (const path of ['/admin', '/admin/students', '/admin/classrooms', '/admin/attendance', '/admin/reports', '/admin/account']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('link', { name: 'Students', exact: true }).last().click();
  await expect(page).toHaveURL(/\/admin\/students$/);
});

test('new admin screens and the parent portal fit a phone screen', async ({ page, browser }) => {
  await signIn(page, 'principal');
  for (const path of ['/admin/fees', '/admin/exams', '/admin/homework', '/admin/analytics', '/admin/id-cards', '/admin/sms']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const wide = await page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const el = [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > w + 1 && !e.closest('.overflow-x-auto')).pop();
      return el ? `${el.tagName}.${(el as HTMLElement).className}`.slice(0, 160) : '';
    });
    expect(wide, `${path}: element wider than the screen`).toBe('');
    await expectNoHorizontalScroll(page);
  }
  // A parent account for a guardian of one student, created through the API.
  const token = (await page.context().cookies()).find((c) => c.name === 'sms_csrf')!.value;
  const headers = { 'x-csrf-token': token };
  const students = (await (await page.request.get('/api/students?pageSize=50')).json()).data as { _id: string; fullName: string }[];
  const unique = Date.now().toString().slice(-6);
  const g = (await (await page.request.post('/api/guardians', { headers, data: { fullName: 'DEMO Phone Father', relation: 'Father', phone: `0301${unique}2` } })).json()).data;
  await page.request.post(`/api/guardians/students/${students[0]!._id}/link`, { headers, data: { guardianId: g._id } });
  const acc = (await (await page.request.post(`/api/guardians/${g._id}/portal-account`, { headers, data: { username: `phone${unique}` } })).json()).data;
  const ctx = await browser.newContext({ viewport: page.viewportSize()!, isMobile: true, hasTouch: true });
  const pp = await ctx.newPage();
  await pp.goto('/parent/login');
  await pp.getByLabel('Username').fill(`phone${unique}`);
  await pp.getByLabel('Password').fill(acc.temporaryPassword);
  await pp.getByRole('button', { name: 'Sign in' }).click();
  await pp.waitForURL(/\/parent$/);
  await expect(pp.getByRole('heading', { name: students[0]!.fullName })).toBeVisible();
  await expectNoHorizontalScroll(pp);
  await pp.getByRole('link', { name: 'View details' }).first().click();
  for (const tab of ['Attendance', 'Results', 'Fees']) {
    await pp.getByRole('tab', { name: tab }).click();
    await expectNoHorizontalScroll(pp);
  }
  await ctx.close();
});
