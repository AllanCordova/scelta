import { defineConfig, devices } from "@playwright/test";

const apiOrigin = "http://127.0.0.1:3334";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command:
        "pnpm --dir ../.. --filter @scelta/domain build && pnpm --dir ../.. --filter @scelta/db build && pnpm --dir ../.. --filter @scelta/api exec tsx src/index.ts",
      url: `${apiOrigin}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        SCELTA_DB: "pglite",
        ADMIN_EMAIL: "e2e-admin@scelta.test",
        ADMIN_PASSWORD: "e2e-admin-password",
        ADMIN_NAME: "Ana Admin",
        CHURCH_NAME: "E2E church",
        API_HOST: "127.0.0.1",
        API_PORT: "3334",
        CORS_ORIGIN: "http://127.0.0.1:5174",
        NODE_ENV: "development",
      },
    },
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_API_URL: "",
        VITE_API_PROXY: apiOrigin,
      },
    },
  ],
});
