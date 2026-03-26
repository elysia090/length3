/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4321';
const chromiumLaunchArgs = [
  '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND',
];

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
      testIgnore: ['**/screenshot.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL,
        launchOptions: { args: chromiumLaunchArgs },
      },
    },
    {
      name: 'screenshots',
      testMatch: ['**/screenshot.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL,
        launchOptions: { args: chromiumLaunchArgs },
      },
    },
  ],
  webServer: {
    command: 'env -u NO_COLOR FORCE_COLOR=0 pnpm exec astro dev --host 127.0.0.1 --port 4321',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
  },
});
