import { defineConfig, devices } from '@playwright/test';

/**
 * Dedicated port for the E2E preview server. It is not the default `vite preview`
 * port (4173), the dev server (5173) or the phone-test origin (4180), and the
 * server is never reused: a stale preview left on this port makes the run fail
 * ("port already used") instead of silently testing an old build.
 */
const E2E_PORT = 4176;

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${E2E_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  // On CI the workflow builds once before this step, so only the preview server is started.
  webServer: {
    command: `${process.env.CI ? '' : 'npm run build && '}npm run preview -- --port ${E2E_PORT} --strictPort`,
    port: E2E_PORT,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
