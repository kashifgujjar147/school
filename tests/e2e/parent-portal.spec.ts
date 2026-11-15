/**
 * Parent portal end-to-end: a guardian linked to two children gets a portal account, signs in on
 * the parent page, sees both children (and only them), and staff pages stay out of reach.
 * Also covers the new admin screens (fees, exams, homework, analytics, ID cards) loading cleanly.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const PW = 'E2e-Password-1';
const problems: string[] = [];

test.beforeEach(({ page }) => {
  problems.length = 0;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
});
test.afterEach(() => { expect(problems, problems.join('\n')).toEqual([]); });

async function staffSignIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === 'sms_csrf')!.value;
}

async function api(req: APIRequestContext, token: string, method: 'post' | 'patch', url: string, data: unknown) {
  const r = await req[method](url, { data, headers: { 'x-csrf-token': token } });
  expect(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data;
}

test('guardian → portal account → parent sees exactly their two children', async ({ page, browser }) => {
  await staffSignIn(page, 'principal');
  const token = await csrf(page);
  const students = (await (await page.request.get('/api/students?pageSize=50')).json()).data as { _id: string; fullName: string }[];
  const ali = students.find((s) => s.fullName === 'DEMO Ali')!; const sara = students.find((s) => s.fullName === 'DEMO Sara')!;
  const unique = Date.now().toString().slice(-6);
  const g = await api(page.request, token, 'post', '/api/guardians', { fullName: `DEMO Mother ${unique}`, relation: 'Mother', phone: `0300${unique}1` });
  for (const s of [ali, sara]) await api(page.request, token, 'post', `/api/guardians/students/${s._id}/link`, { guardianId: g._id });

  // Create the portal account from the Guardians page (UI).
  await page.goto('/admin/guardians');
  const row = page.getByRole('row', { name: new RegExp(`DEMO Mother ${unique}`) });
  await row.getByRole('button', { name: 'Create portal account' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Username').fill(`parent${unique}`);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByText(/Account created/)).toBeVisible();
  const tempPassword = (await dialog.locator('code').nth(1).textContent())!.trim();
  expect(tempPassword).toMatch(/^[A-Za-z0-9]{14}$/);

  // Fees: issue a voucher for Ali so the parent sees a real balance.
  await api(page.request, token, 'post', '/api/fees/vouchers', { studentId: ali._id, title: 'DEMO Tuition', period: '2026-11', dueDate: '2026-11-30', items: [{ label: 'Tuition', amountMinor: 450000 }] });

  // Parent signs in on the parent page (fresh browser context = separate device).
  const ctx = await browser.newContext();
  const pp = await ctx.newPage();
  pp.on('pageerror', (e) => problems.push(`parent pageerror: ${e.message}`));
  await pp.goto('/parent/login');
  await expect(pp.getByText('Parent sign in')).toBeVisible();
  await pp.getByLabel('Username').fill(`parent${unique}`);
  await pp.getByLabel('Password').fill(tempPassword);
  await pp.getByRole('button', { name: 'Sign in' }).click();
  await pp.waitForURL(/\/parent$/);
  await expect(pp.getByRole('heading', { name: 'DEMO Ali' })).toBeVisible();
  await expect(pp.getByRole('heading', { name: 'DEMO Sara' })).toBeVisible();
  await expect(pp.getByRole('heading', { name: 'DEMO Omar' })).toHaveCount(0);

  // Child detail → fees tab shows the voucher; online payment shows the honest "not available" state.
  await pp.getByRole('heading', { name: 'DEMO Ali' }).locator('xpath=ancestor::article').getByRole('link', { name: 'View details' }).click();
  await pp.getByRole('tab', { name: 'Fees' }).click();
  await expect(pp.getByText('DEMO Tuition')).toBeVisible();
  await expect(pp.getByText(/Online payment is not available yet/)).toBeVisible();
  for (const tab of ['Attendance', 'Results', 'Homework', 'Teacher feedback', 'Profile']) {
    await pp.getByRole('tab', { name: tab }).click();
    await expect(pp.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  // The parent cannot open staff pages or another child's data.
  await pp.goto('/admin/students');
  await pp.waitForURL(/\/parent$/);
  const omar = students.find((s) => s.fullName === 'DEMO Omar')!;
  expect((await pp.request.get(`/api/parent/children/${omar._id}`)).status()).toBe(404);
  expect((await pp.request.get('/api/students')).status()).toBe(403);
  await ctx.close();
});

test('new admin screens load without errors', async ({ page }) => {
  await staffSignIn(page, 'principal');
  for (const [path, heading] of [['/admin/fees', 'Fees'], ['/admin/exams', 'Exams & results'], ['/admin/homework', 'Homework'], ['/admin/analytics', 'Analytics'], ['/admin/id-cards', 'ID cards']] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
  }
});

test('ID card QR link verifies publicly with minimal information', async ({ page, browser }) => {
  await staffSignIn(page, 'principal');
  const students = (await (await page.request.get('/api/students?pageSize=50')).json()).data as { _id: string; fullName: string }[];
  const hira = students.find((s) => s.fullName === 'DEMO Hira')!;
  const pdf = await page.request.get(`/api/id-cards/students/${hira._id}?layout=card`);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  // The token only exists inside the QR code (the server tests cover a real token). Here: an
  // unknown token in a signed-out browser shows the failure page and nothing else.
  const ctx = await browser.newContext();
  const anon = await ctx.newPage();
  await anon.goto('/verify/' + 'x'.repeat(32));
  await expect(anon.getByText('This card could not be verified.')).toBeVisible();
  await ctx.close();
});
