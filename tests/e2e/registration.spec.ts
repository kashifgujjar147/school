import { expect, test, type Page } from '@playwright/test';

const PW = 'E2e-Password-1';
const NEW_PW = 'New-Account-77';

async function signIn(page: Page, username: string, password = PW) {
  await page.goto('/login');
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('create account -> pending -> principal approves -> teacher dashboard', async ({ page, browser }) => {
  // 1. Create Account opens from the login screen.
  await page.goto('/login');
  await page.getByTestId('create-account-link').click();
  await expect(page).toHaveURL(/\/register$/);

  // 2. Frontend validation: mismatched confirmation blocks submission.
  await page.getByLabel('Full name').fill('Esa Registrant');
  await page.getByLabel('Email').fill('esa.registrant@example.com');
  await page.getByLabel('Password', { exact: true }).fill(NEW_PW);
  await page.getByLabel('Confirm password').fill('Something-Else-1');
  await expect(page.getByText('Passwords do not match')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await page.getByLabel('Confirm password').fill(NEW_PW);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByTestId('register-success')).toContainText('esa.registrant');

  // 3. Duplicate email is rejected by the server.
  await page.goto('/register');
  await page.getByLabel('Full name').fill('Someone Else');
  await page.getByLabel('Email').fill('ESA.registrant@example.com');
  await page.getByLabel('Password', { exact: true }).fill(NEW_PW);
  await page.getByLabel('Confirm password').fill(NEW_PW);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(/already exists/)).toBeVisible();

  // 4. The pending account cannot sign in and sees a clear message.
  await signIn(page, 'esa.registrant@example.com', NEW_PW);
  await expect(page.getByText('Account pending approval')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);

  // 5. Principal approves the account as a teacher on the Users page.
  const admin = await browser.newPage();
  await signIn(admin, 'principal');
  await admin.waitForURL(/\/admin/);
  await admin.goto('/admin/users');
  await admin.getByRole('button', { name: /Pending approval: 1/ }).click();
  await admin.getByRole('row', { name: /Esa Registrant/ }).getByRole('button', { name: 'Edit' }).click();
  const panel = admin.getByTestId('approve-panel');
  await panel.getByLabel('Role').selectOption('teacher');
  await panel.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText('Saved')).toBeVisible();
  await admin.close();

  // 6. Now the new credentials work and redirect to the teacher dashboard.
  await signIn(page, 'esa.registrant', NEW_PW);
  await page.waitForURL(/\/teacher/);
  // Teacher cannot open the admin dashboard.
  await page.goto('/admin/users');
  await expect(page.getByText('You do not have access to this page.')).toBeVisible();
});
