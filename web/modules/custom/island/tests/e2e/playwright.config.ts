import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  // One worker: the PHP built-in server is single-threaded and the demo
  // store is shared server-side state; parallel tests would starve and
  // race each other.
  workers: 1,
  use: {
    baseURL: process.env.ISLAND_E2E_BASE_URL ?? 'http://127.0.0.1:8973',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: [['junit', { outputFile: process.env.ISLAND_E2E_JUNIT ?? 'junit-island.xml' }], ['list']],
});
