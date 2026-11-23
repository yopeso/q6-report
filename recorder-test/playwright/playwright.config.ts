import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests',
  // Beside this config; Playwright's default is beside the nearest package.json, which is the repository's root.
  outputDir: './test-results',
  // One worker keeps the order of the results, and the results file of one process, the same on every machine.
  workers: 1,
  retries: 1,
  reporter: [[process.env.Q6_RECORDER ?? 'q6-report/playwright']],
  use: {
    // The installed Google Chrome, so the check downloads no browser.
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true },
  },
});
