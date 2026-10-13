import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  outputDir: 'work/playwright',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4180', viewport: { width: 1280, height: 900 },
    launchOptions: { channel: 'chrome' }, screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/preview.mjs', url: 'http://127.0.0.1:4180',
    reuseExistingServer: true,
  },
});
