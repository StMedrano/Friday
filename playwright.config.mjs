import { defineConfig } from '@playwright/test'

// Mock-mode, zero-credential smoke test of the built dashboard. Run `npm run build` first.
export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI ? 'list' : 'line',
  use: {
    baseURL: 'http://127.0.0.1:8772',
    browserName: 'chromium',
    ...(process.env.FRIDAY_E2E_EXECUTABLE ? { launchOptions: { executablePath: process.env.FRIDAY_E2E_EXECUTABLE } } : {}),
  },
  webServer: {
    command: 'node tests/e2e/mock-server.mjs',
    url: 'http://127.0.0.1:8772/healthz',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
