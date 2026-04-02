/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4321';
const desktopChrome = {
  ...devices['Desktop Chrome'],
  baseURL,
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: process.env['CI'] ? [['github'], ['html']] : [['html']],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['**/docs/**/*.spec.ts'],
      use: desktopChrome,
    },
    {
      name: 'screenshots',
      testMatch: ['**/docs/**/*.spec.ts'],
      use: desktopChrome,
    },
  ],
  webServer: {
    command: 'env -u NO_COLOR FORCE_COLOR=0 pnpm exec astro dev --host 127.0.0.1 --port 4321',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
  },
});
