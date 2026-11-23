/**
 * Browser workflows for the administration side: real clicks in a real browser against the real
 * server and database (DEMO school from start-e2e-server.mts). Each test checks the visible result
 * AND that it persisted (reload / re-query). Runs after app.spec.ts (alphabetical, one worker), so it
 * never changes the seeded DEMO 5-A roster that app.spec.ts relies on before it runs.
 *
 * Every test fails on uncaught page errors, React console errors and any API 5xx.
 */
import { expect, test, type Page } from '@playwright/test';

const PW = 'E2e-Password-1';
const problems: string[] = [];

test.beforeEach(({ page }) => {
  problems.length = 0;
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // 4xx responses are expected in negative paths (e.g. a wrong password); the browser logs them as
  // "Failed to load resource". Everything else logged as an error is a defect.
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
});
test.afterEach(() => { expect(problems, problems.join('\n')).toEqual([]); });

async function fillLogin(page: Page, username: string, password = PW) {
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function signIn(page: Page, username: string, password = PW) {
  await page.goto('/login');
  await fillLogin(page, username, password);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}
async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL(/\/login/);
}
/** Same-origin API call with the session + CSRF cookies of the signed-in page. */
async function api(page: Page, method: 'POST' | 'PATCH', url: string, data: object) {
  const csrf = (await page.context().cookies()).find((c) => c.name === 'sms_csrf')?.value ?? '';
  const r = await page.request.fetch(url, { method, data, headers: { 'X-CSRF-Token': csrf } });
  expect(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`).toBeTruthy();
  return (await r.json()).data;
}
const dialog = (page: Page) => page.getByRole('dialog');
const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

test('every admin page loads, survives a refresh, and has no console errors', async ({ page }) => {
  await signIn(page, 'principal');
  const pages: [string, RegExp, string | RegExp][] = [
    ['Home', /\/admin$/, /^Welcome back/], ['Students', /\/admin\/students$/, 'Students'], ['Classrooms', /\/admin\/classrooms$/, 'Classrooms'],
    ['Staff & users', /\/admin\/users$/, 'Staff & users'], ['Attendance', /\/admin\/attendance$/, 'Attendance'], ['Corrections', /\/admin\/corrections$/, 'Corrections'],
    ['Parents & guardians', /\/admin\/guardians$/, 'Parents & guardians'], ['SMS alerts', /\/admin\/sms$/, 'SMS alerts'], ['Reports', /\/admin\/reports$/, 'Reports'],
    ['Settings', /\/admin\/settings$/, 'Settings'], ['Website Management', /\/admin\/website$/, 'Website Management'], ['Security', /\/admin\/security$/, 'Security'],
    ['System health', /\/admin\/health$/, 'System health'], ['Backups', /\/admin\/backups$/, 'Backups'], ['Synchronisation', /\/admin\/sync$/, 'Synchronisation'],
    ['Change password', /\/admin\/account$/, 'Account settings']
  ];
  for (const [link, url, heading] of pages) {
    const nav = page.getByRole('navigation', { name: 'Main' });
    // Technical pages sit in the collapsed "Advanced" group of the side menu.
    if (!(await nav.getByRole('link', { name: link, exact: true }).isVisible())) await nav.getByText('Advanced').click();
    await nav.getByRole('link', { name: link, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(h1(page)).toHaveText(heading);
    await page.reload(); // deep link refresh served by the SPA fallback
    await expect(h1(page)).toHaveText(heading);
  }
  await page.goto('/admin/no-such-page');
  await expect(page.getByText('Page not found.')).toBeVisible();
});

test('signed-out users are sent to login and back; ?next cannot leave the site', async ({ page }) => {
  await page.goto('/admin/reports');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Freports$/);
  await fillLogin(page, 'principal');
  await expect(page).toHaveURL(/\/admin\/reports$/);
  await expect(h1(page)).toHaveText('Reports');
  await signOut(page);
  await page.goto('/login?next=//evil.example/steal');
  await fillLogin(page, 'principal');
  await expect(page).toHaveURL('http://127.0.0.1:8099/admin');
});

test('student lifecycle: admit, open, edit, archive, restore — all persisted', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/students');
  await page.getByRole('button', { name: 'Add student' }).click();
  await dialog(page).getByLabel('Admission no.').fill('E2E-W1');
  await dialog(page).getByLabel('Full name').fill('DEMO Zainab');
  await dialog(page).getByLabel('Classroom').selectOption({ label: 'DEMO 5-A' });
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.getByRole('link', { name: 'DEMO Zainab' }).click();
  await expect(h1(page)).toHaveText('DEMO Zainab');
  await page.getByRole('button', { name: 'Edit' }).click();
  await dialog(page).getByLabel('Full name').fill('DEMO Zainab Ali');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(h1(page)).toHaveText('DEMO Zainab Ali');
  await page.reload();
  await expect(h1(page)).toHaveText('DEMO Zainab Ali');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText('Status updated.')).toBeVisible();
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  // Delete needs a reason: the dialog explains instead of sending a request the server would refuse.
  await page.getByRole('button', { name: 'Delete' }).click();
  await dialog(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog(page).getByText('Enter a reason (at least 3 characters).').last()).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await page.goto('/admin/students');
  await page.getByPlaceholder(/Search/).fill('E2E-W1');
  await expect(page.getByRole('link', { name: 'DEMO Zainab Ali' })).toBeVisible();
});

test('classes, sections and classrooms: create, rename, archive with confirmation, restore', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/classrooms');
  await page.getByRole('tab', { name: 'Classes & Sections' }).click();
  await page.getByPlaceholder('Class', { exact: true }).fill('DEMO Grade 6');
  await page.getByRole('button', { name: 'Add class' }).click();
  const row = page.getByRole('listitem').filter({ hasText: 'DEMO Grade 6' });
  await row.getByPlaceholder('Section').fill('A');
  await row.getByRole('button', { name: 'Add section' }).click();
  await expect(row.getByText('A', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Edit' }).click();
  await dialog(page).getByLabel('Class', { exact: true }).fill('DEMO Grade 6X');
  await dialog(page).getByRole('button', { name: 'Save' }).first().click();
  await dialog(page).getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.getByRole('listitem').filter({ hasText: 'DEMO Grade 6X' })).toBeVisible();

  await page.getByRole('tab', { name: 'Classrooms', exact: true }).click();
  await page.getByRole('button', { name: 'Add classroom' }).click();
  await dialog(page).getByLabel('Class', { exact: true }).selectOption({ label: 'DEMO Grade 6X' });
  await dialog(page).getByLabel('Section', { exact: true }).selectOption({ label: 'A' });
  await expect(dialog(page).getByLabel('Name')).toHaveValue('DEMO Grade 6X-A');
  await dialog(page).getByLabel('Room').fill('R-6'); // typing in a parent-state field must not steal focus
  await expect(dialog(page).getByLabel('Room')).toHaveValue('R-6');
  await dialog(page).getByRole('button', { name: 'Create' }).click();
  const card = page.locator('.card').filter({ hasText: 'DEMO Grade 6X-A' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Archive' }).click();
  await expect(dialog(page)).toContainText('It must have no active students');
  await dialog(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(card).toHaveCount(0);
  await page.getByLabel('Show archived').check();
  await expect(card.getByText('Archived')).toBeVisible();
  await card.getByRole('button', { name: 'Restore' }).click();
  await page.getByLabel('Show archived').uncheck();
  await expect(card).toBeVisible();
  await page.reload();
  await expect(page.locator('.card').filter({ hasText: 'DEMO Grade 6X-A' })).toBeVisible();
});

test('class promotion moves only the selected students and keeps everyone else in place', async ({ page }) => {
  await signIn(page, 'principal');
  const rooms = (await (await page.request.get('/api/academic/classrooms')).json()).data as { _id: string; name: string }[];
  const from = rooms.find((r) => r.name === 'DEMO 5-A')!;
  await api(page, 'POST', '/api/students', { admissionNumber: 'E2E-P1', fullName: 'DEMO Promote Me', classroomId: from._id });
  await page.goto('/admin/classrooms');
  const card = page.locator('.card').filter({ hasText: 'DEMO 5-A' });
  await card.getByRole('button', { name: 'Promote / move class' }).click();
  await expect(dialog(page).getByLabel(/Select all \(\d+\/\d+\)/)).toBeChecked();
  await dialog(page).getByLabel(/Select all/).uncheck();
  await dialog(page).getByLabel(/DEMO Promote Me/).check();
  await dialog(page).getByLabel('Destination classroom').selectOption({ label: 'DEMO Grade 6X-A' });
  await dialog(page).getByLabel('Reason').fill('Year-end promotion (e2e)');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('1 student(s) moved, 0 skipped.')).toBeVisible();
  await expect(page.locator('.card').filter({ hasText: 'DEMO Grade 6X-A' }).getByText('1 students')).toBeVisible();
  const moved = (await (await page.request.get('/api/students?q=E2E-P1')).json()).data[0];
  expect(moved.classroomName).toBe('DEMO Grade 6X-A');
});

test('guardian added from a student profile is found by a local-format phone search', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/students');
  await page.getByPlaceholder(/Search/).fill('E2E-P1');
  await page.getByRole('link', { name: 'DEMO Promote Me' }).click();
  await page.getByRole('button', { name: 'Add guardian' }).click();
  await dialog(page).getByLabel('Full name').fill('DEMO Parent');
  await dialog(page).getByLabel('Relation').fill('Mother');
  await dialog(page).getByLabel('Phone', { exact: true }).fill('0300 7654321');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('+923007654321')).toBeVisible();
  await page.goto('/admin/guardians');
  await page.getByPlaceholder(/Search/).fill('0300 765 4321');
  await expect(page.getByRole('cell', { name: 'DEMO Parent' })).toBeVisible();
  await page.goto('/admin/students');
  await page.getByPlaceholder(/Search/).fill('03007654321');
  await expect(page.getByRole('link', { name: 'DEMO Promote Me' })).toBeVisible();
});

test('custom student fields: define in settings, fill on the student form, shown on the profile', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/settings');
  await page.getByRole('tab', { name: 'Academic settings' }).click();
  await page.getByLabel('Label', { exact: true }).fill('Blood group');
  await page.getByLabel('Key (letters, digits, _)').fill('bloodGroup');
  await page.getByRole('button', { name: 'Add field' }).click();
  await expect(page.getByRole('cell', { name: 'bloodGroup' })).toBeVisible();
  await page.goto('/admin/students');
  await page.getByPlaceholder(/Search/).fill('E2E-P1');
  await page.getByRole('link', { name: 'DEMO Promote Me' }).click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await dialog(page).getByLabel('Blood group').fill('O+');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await page.reload();
  const details = page.locator('dl');
  await expect(details.getByText('Blood group')).toBeVisible();
  await expect(details.getByText('O+', { exact: true })).toBeVisible();
});

test('backups: create reports verification honestly; verify again', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/backups');
  await page.getByRole('button', { name: 'Create backup now' }).click();
  await expect(page.getByText('Backup created and verified.')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Verify' }).first().click();
  await expect(page.getByText('Backup verified: checksum and record counts match.')).toBeVisible();
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await dialog(page).getByRole('button', { name: 'Restore', exact: true }).click(); // phrase and password missing
  await expect(dialog(page).getByText('Type RESTORE and enter your password to continue.')).toBeVisible();
  await dialog(page).getByLabel(/Type RESTORE/).fill('RESTO');
  await dialog(page).getByLabel(/password/i).fill('abc'); // typing in the 2nd field keeps focus there
  await expect(dialog(page).getByLabel(/Type RESTORE/)).toHaveValue('RESTO');
  await expect(dialog(page).getByLabel(/password/i)).toHaveValue('abc');
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
});

test('generated password signs in directly; optional change in account settings; old password stops working', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/users');
  await page.getByRole('button', { name: 'Add user' }).click();
  await dialog(page).getByLabel('Username').fill('e2estaff');
  await dialog(page).getByLabel('Full name').fill('DEMO Office Staff');
  await dialog(page).getByLabel('Role').selectOption('staff');
  await dialog(page).getByLabel('Temporary password').fill('Temp-Pass-1234');
  await dialog(page).getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('cell', { name: 'e2estaff' })).toBeVisible();
  await signOut(page);

  await signIn(page, 'e2estaff', 'Temp-Pass-1234');
  await expect(page).toHaveURL(/\/admin$/); // straight to the dashboard, no forced change
  await page.getByRole('link', { name: 'Change password' }).click();
  await page.getByLabel('Current password').fill('Temp-Pass-1234');
  await page.getByLabel('New password', { exact: true }).fill('Fresh-Pass-5678');
  await page.getByLabel('Confirm new password').fill('Fresh-Pass-5678');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Your password has been updated/)).toBeVisible();
  await signOut(page);
  await fillLogin(page, 'e2estaff', 'Temp-Pass-1234');
  await expect(page.getByText(/Incorrect username or password/)).toBeVisible();
  await signIn(page, 'e2estaff', 'Fresh-Pass-5678');
  await expect(page).toHaveURL(/\/admin$/);
});

test('user profile (name, email) can be edited from the users page and persists', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/users');
  await page.getByRole('row').filter({ hasText: 'e2estaff' }).getByRole('button', { name: 'Edit' }).click();
  await dialog(page).getByLabel('Full name').fill('DEMO Office Manager');
  await dialog(page).getByLabel('Email').fill('office@example.org');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page).getByText('Saved')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('cell', { name: 'DEMO Office Manager' })).toBeVisible();
  await page.getByRole('row').filter({ hasText: 'e2estaff' }).getByRole('button', { name: 'Edit' }).click();
  await expect(dialog(page).getByLabel('Email')).toHaveValue('office@example.org');
});

test('public website and announcements: publish, show on /site, delete with confirmation', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/website/settings');
  await page.getByLabel('Publish the public school website').check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  // Announcements now live under Website Management → News & events.
  await page.goto('/admin/website/news');
  await page.getByRole('tab', { name: 'Announcements' }).click();
  await page.getByRole('button', { name: 'Add announcement' }).click();
  await dialog(page).getByLabel('Title').fill('DEMO Sports Day');
  await dialog(page).getByLabel('Text').fill('Friday on the main ground.');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  const row = page.getByRole('row').filter({ hasText: 'DEMO Sports Day' });
  await expect(row.getByText('Draft')).toBeVisible();
  await row.getByRole('button', { name: 'Publish' }).click();
  await expect(row.getByText(/Published/)).toBeVisible();
  await page.goto('/site');
  await expect(page.getByRole('heading', { name: 'DEMO Sports Day' })).toBeVisible();
  await page.goto('/admin/website/news');
  await page.getByRole('tab', { name: 'Announcements' }).click();
  await page.getByRole('row').filter({ hasText: 'DEMO Sports Day' }).getByRole('button', { name: 'Delete' }).click();
  await expect(dialog(page)).toContainText('DEMO Sports Day');
  await dialog(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'DEMO Sports Day' })).toHaveCount(0);
  await page.goto('/site');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'DEMO Sports Day' })).toHaveCount(0);
});

test('attendance monitor: sheet view with audit trail; correction requested by the teacher, approved by the principal', async ({ page }) => {
  // app.spec.ts submitted today's register for DEMO 5-A (DEMO Sara absent).
  await signIn(page, 'teacher');
  await page.getByRole('link', { name: 'History' }).click();
  await page.getByRole('row').filter({ hasText: 'DEMO 5-A' }).first().getByRole('button', { name: 'View' }).click();
  await dialog(page).getByRole('listitem').filter({ hasText: 'DEMO Sara' }).getByRole('button', { name: 'Request correction' }).click();
  await page.getByRole('dialog', { name: /Request correction/ }).getByLabel('Reason').fill('Arrived during first period');
  await page.getByRole('dialog', { name: /Request correction/ }).getByRole('button', { name: 'Submit attendance' }).click();
  await expect(page.getByText('Correction requested. The principal will review it.')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await signOut(page);

  await signIn(page, 'principal');
  await page.goto('/admin/corrections');
  const req = page.getByRole('row').filter({ hasText: 'DEMO Sara' });
  await req.getByRole('button', { name: 'Approve' }).click();
  await dialog(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(req).toHaveCount(0);
  await page.getByRole('tab', { name: 'Approved', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'DEMO Sara' })).toBeVisible();

  await page.goto('/admin/attendance');
  await page.getByRole('row').filter({ hasText: 'DEMO 5-A' }).getByRole('button', { name: 'View' }).click();
  const sara = dialog(page).getByRole('row').filter({ hasText: 'DEMO Sara' });
  await expect(sara.getByText('Present')).toBeVisible();
  await sara.getByRole('button', { name: 'Audit trail' }).click();
  const trail = dialog(page).getByRole('listitem');
  await expect(trail.filter({ hasText: 'submitted' })).toBeVisible();
  await expect(trail.filter({ hasText: 'correction requested' })).toContainText('DEMO Teacher');
  await expect(trail.filter({ hasText: 'correction approved' })).toContainText('DEMO Principal');
});

test('an administrator can mark attendance for any classroom from "Mark attendance"', async ({ page }) => {
  await signIn(page, 'principal');
  await page.getByRole('link', { name: 'Mark attendance' }).click();
  await expect(page).toHaveURL(/\/teacher$/);
  await expect(page.getByText('DEMO 5-A')).toBeVisible();
  await expect(page.getByText('DEMO Grade 6X-A')).toBeVisible();
});

test('reports: presets in school time, generate, filter; SMS usage and phone search', async ({ page }) => {
  await signIn(page, 'principal');
  await page.goto('/admin/reports');
  await page.getByRole('button', { name: 'Today' }).click();
  const schoolToday = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date()));
  await expect(page.getByLabel('From')).toHaveValue(schoolToday);
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText('Attendance summary by classroom')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'DEMO 5-A' })).toBeVisible();
  await page.goto('/admin/sms');
  await expect(page.getByText('Usage this month')).toBeVisible();
  await page.getByPlaceholder(/Search: Phone/).fill('0300');
  await expect(page.getByRole('heading', { name: 'Queue & delivery' })).toBeVisible();
  await expect(page.getByPlaceholder(/Search: Phone/)).toHaveValue('0300');
});
