import { expect, test } from '@playwright/test';

const PW = 'E2e-Password-1';

test('full offline mode: never-visited dashboards open, changes queue offline and sync when back online', async ({ page, context }) => {
  // Offline preparation is deliberately gentle (rate limits), and the test waits for it plus a reconnect.
  test.setTimeout(120_000);
  await page.goto('/login');
  await page.getByLabel('Username or email').fill('principal');
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/admin/);
  // Background offline preparation downloads every permitted dashboard's data after sign-in.
  await page.waitForLoadState('networkidle');
  // Wait until the preparation has stored the data of pages this test will open offline.
  const cachedUrls = () => page.evaluate(() => new Promise<string[]>((res) => {
    const r = indexedDB.open('sms-offline');
    r.onsuccess = () => { const q = r.result.transaction('httpCache').objectStore('httpCache').getAllKeys(); q.onsuccess = () => res(q.result.map((k) => String(k).split('|')[1] ?? '')); };
    r.onerror = () => res([]);
  }));
  await expect.poll(async () => {
    const urls = await cachedUrls();
    return ['/api/fees/summary', '/api/exams', '/api/academic/classrooms', '/api/users?page=1&pageSize=25'].every((u) => urls.includes(u))
      && urls.filter((u) => /^\/api\/users\/[0-9a-f-]{36}$/.test(u)).length >= 2;
  }, { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(2500); // page code preloading starts 1.5 s after sign-in

  await context.setOffline(true);

  // Pages never opened in this session still open offline, from the prepared data.
  for (const [link, heading] of [['Fees', 'Fees'], ['Exams & results', /Exams/], ['Classrooms', /Class/], ['Staff & users', 'Staff & users']] as const) {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    await expect(page.getByText('The school server cannot be reached')).toHaveCount(0);
  }

  // A change made offline is kept on the device (not lost, not an error).
  await page.getByRole('row', { name: /DEMO Teacher/ }).getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Phone').fill('03001112233');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText(/saved on this device/)).toBeVisible();
  // Pressing Save again offline does not queue a duplicate.
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('1 waiting to sync')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Back online: the queued change is delivered automatically and appears on the server.
  await context.setOffline(false);
  const badge = page.getByText(/waiting to sync/);
  // The badge can vanish mid-click when the automatic sync finishes first: never wait long for it.
  if (await badge.isVisible()) await badge.click({ timeout: 2_000 }).catch(() => undefined);
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0, { timeout: 30_000 });
  const users = (await (await page.request.get('/api/users?q=DEMO%20Teacher')).json()).data as { fullName: string; phone?: string }[];
  expect(users.find((u) => u.fullName === 'DEMO Teacher')?.phone).toBe('03001112233');
});
