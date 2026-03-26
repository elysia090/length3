/// <reference types="node" />
import { defineConfig, devices } from '@playwright/test';

const isScreenshotMode = process.env['SCREENSHOT_MODE'] === '1';
const baseURL = isScreenshotMode ? 'http://localhost:4322' : 'http://localhost:4321';
const chromiumLaunchArgs = [
  // Fail Google Fonts DNS lookups immediately in headless runs. The site links
  // Google Fonts declaratively in <head>, but some proxied CI environments can
  // hang on those external requests and delay load-related waits.
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
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      // Primary behavior test project — runs all specs except screenshots.
      name: 'chromium',
      testIgnore: ['**/screenshot.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: chromiumLaunchArgs },
      },
    },
    {
      // Screenshot-only project for documentation capture.
      // Kept separate so normal E2E is not used as a visual regression suite.
      name: 'screenshots',
      testMatch: ['**/screenshot.spec.ts'],
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: chromiumLaunchArgs },
      },
    },
  ],

  webServer: {
    command: isScreenshotMode ? 'pnpm preview --port 4322' : 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
  },
});
