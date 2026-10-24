import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: 10_000,
    baseURL: 'http://127.0.0.1:4173',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run -w relay build && npm run -w relay start',
      cwd: '..',
      url: 'http://127.0.0.1:8080/health',
      env: {
        RELAY_HOST: '127.0.0.1',
        RELAY_PORT: '8080',
        RELAY_WEB_PUSH_PUBLIC_KEY: '',
        RELAY_WEB_PUSH_PRIVATE_KEY: '',
        RELAY_WEB_PUSH_SUBJECT: '',
      },
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 120_000,
    },
    {
      command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      env: { GITHUB_ACTIONS: 'false' },
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 120_000,
    },
  ],
});
