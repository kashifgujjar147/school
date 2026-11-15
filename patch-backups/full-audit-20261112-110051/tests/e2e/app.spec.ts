import { expect, test, type Page } from '@playwright/test';

const PW = 'E2e-Password-1';

async function signIn(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('principal signs in and dashboard shows real totals', async ({ page }) => {
  await signIn(page, 'principal');
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText('Total students')).toBeVisible();
  await expect(page.locator('.num', { hasText: /^4$/ }).first()).toBeVisible();
  for (const link of ['Students', 'Classrooms', 'Reports', 'System health']) {
    await page.getByRole('link', { name: link }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('teacher marks attendance online', async ({ page }) => {
  await signIn(page, 'teacher');
  await page.getByText('DEMO 5-A').click();
  await page.getByRole('button', { name: 'Mark all present' }).click();
  await page.getByRole('radiogroup', { name: 'DEMO Sara' }).getByRole('radio', { name: 'Absent' }).click();
  await page.getByRole('button', { name: 'Review & submit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit attendance' }).click();
  await expect(page.getByText('Attendance submitted.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Attendance for this date is already submitted.')).toBeVisible();
});

test('teacher works offline; submission syncs when the connection returns', async ({ page, context }) => {
  await signIn(page, 'teacher');
  await page.getByRole('link', { name: 'History' }).click();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  // Load the roster once online so it is cached on the device.
  await page.goto(`/teacher/mark/${await classroomId(page)}?date=${yesterday}`);
  await expect(page.getByRole('button', { name: 'Mark all present' })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Mark all present' }).click();
  await page.getByRole('button', { name: 'Review & submit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit attendance' }).click();
  await expect(page.getByText('Saved on this device').first()).toBeVisible();
  await expect(page.getByText(/waiting to sync/)).toBeVisible();
  await context.setOffline(false);
  await page.getByText(/waiting to sync/).click(); // sync now
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0, { timeout: 30_000 });
  await page.reload();
  await expect(page.getByText('Attendance for this date is already submitted.')).toBeVisible();
});

test('Urdu switches the layout to RTL', async ({ page }) => {
  await signIn(page, 'principal');
  await page.getByRole('button', { name: 'اردو' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('جائزہ').first()).toBeVisible();
  await page.getByRole('button', { name: 'EN' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('teacher cannot open admin pages', async ({ page }) => {
  await signIn(page, 'teacher');
  await page.goto('/admin/users');
  await expect(page.getByText('You do not have access to this page.')).toBeVisible();
});

async function classroomId(page: Page): Promise<string> {
  const r = await page.request.get('/api/academic/classrooms?mine=true');
  return (await r.json()).data[0]._id;
}
