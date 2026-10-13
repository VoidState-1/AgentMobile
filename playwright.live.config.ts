import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/live', timeout: 360000, workers: 1,
  outputDir: 'work/live-playwright', reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4180', viewport: { width: 390, height: 844 },
    launchOptions: { channel: 'chrome' }, screenshot: 'only-on-failure' },
  webServer: { command: 'node scripts/preview.mjs', url: 'http://127.0.0.1:4180', reuseExistingServer: true },
});
