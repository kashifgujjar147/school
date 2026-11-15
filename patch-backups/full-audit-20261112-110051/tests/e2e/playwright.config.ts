import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. `npm run test:e2e` builds nothing itself: run `npm run build` first.
 * The webServer below starts an isolated in-memory MongoDB replica set, initialises a test
 * school with DEMO data and serves the built client — no external services are touched.
 */
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:8099', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx tsx tests/e2e/start-e2e-server.ts',
    cwd: '../..',
    url: 'http://127.0.0.1:8099/api/health',
    timeout: 180_000,
    reuseExistingServer: false
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /teacher|responsive/ }
  ]
});
