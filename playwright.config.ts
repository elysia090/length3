/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const chromiumLaunchArgs = [
  // Fail Google Fonts DNS lookups immediately so the dynamically-added
  // <link rel="stylesheet"> errors out fast instead of hanging through
  // the proxy, which blocks the window `load` event in headless Chromium.
  '--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND',
];

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  // In CI: emit GitHub annotations (visible in the PR) + HTML for artifact upload.
  // Locally: HTML only (opened with `pnpm exec playwright show-report`).
  reporter: process.env['CI'] ? [['github'], ['html']] : [['html']],

  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // Primary functional test project — runs all specs except screenshots.
      name: 'chromium',
      testIgnore: ['**/screenshot.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: chromiumLaunchArgs },
      },
    },
    {
      // Screenshot-only project — run explicitly with `pnpm screenshots`.
      // Separated so screenshots are not retaken on every `pnpm test` run.
      name: 'screenshots',
      testMatch: ['**/screenshot.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: chromiumLaunchArgs },
      },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env['CI'],
  },
});
