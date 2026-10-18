import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  timeout: 60000,
  retries: 1,
  workers: 1,
  reporter: [['github'], ['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.LIVE_SITE_URL || 'http://127.0.0.1:5173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
