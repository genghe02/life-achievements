import { defineConfig, devices } from '@playwright/test';

const chrome = process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// E2E_BASE_URL points the suite at a server that is already running (an ad-hoc preview on another
// port); then no build or server is started here.
const external = process.env.E2E_BASE_URL;
const baseURL = external || 'http://localhost:4173/';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // toasts queue behind each other (one at a time on phones, 2.6 s each)
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    launchOptions: { executablePath: chrome },
    trace: 'retain-on-failure',
  },
  webServer: external
    ? undefined
    : { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/', reuseExistingServer: true, timeout: 180_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
  ],
});
