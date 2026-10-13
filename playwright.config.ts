import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome =
  process.env.PLAYWRIGHT_CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: 'apps/dashboard/tests',
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: 'http://localhost:8180',
    viewport: { width: 1280, height: 900 },
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
    screenshot: 'only-on-failure',
  },
});
