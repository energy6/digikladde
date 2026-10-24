import { defineConfig, devices } from '@playwright/test';

const useBuildArtifacts = process.env.E2E_USE_BUILD_ARTIFACTS === 'true';
const relayImage = process.env.E2E_RELAY_IMAGE ?? 'digikladde-relay:e2e';
if (useBuildArtifacts && !/^digikladde-relay:[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(relayImage)) {
  throw new Error('E2E_RELAY_IMAGE must be a tagged local digikladde-relay image');
}
const appBasePath = process.env.E2E_APP_BASE_PATH ?? (useBuildArtifacts ? undefined : '/');
if (!appBasePath?.startsWith('/') || !appBasePath.endsWith('/')) {
  throw new Error('E2E_APP_BASE_PATH must start and end with "/" when using build artifacts');
}
const baseURL = `http://127.0.0.1:4173${appBasePath}`;

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
    baseURL,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: useBuildArtifacts
        ? `docker run --rm --init --pull=never --platform linux/amd64 --name digikladde-relay-e2e --publish 127.0.0.1:8080:8080 ${relayImage}`
        : 'npm run -w relay build && npm run -w relay start',
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
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      stdout: 'pipe',
      timeout: 120_000,
    },
    {
      command: `${useBuildArtifacts ? '' : 'npm run build && '}npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`,
      url: baseURL,
      env: { GITHUB_ACTIONS: useBuildArtifacts || appBasePath !== '/' ? 'true' : 'false' },
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 120_000,
    },
  ],
});
