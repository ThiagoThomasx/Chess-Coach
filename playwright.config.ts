import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  // On CI the workflow builds once before this step, so only the preview server is started.
  webServer: {
    command: `${process.env.CI ? '' : 'npm run build && '}npm run preview -- --port 4173 --strictPort`,
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
