import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * Browser tests against a seeded project. They sign in as the demo users (see
 * README "Demo data"), so `NEXT_PUBLIC_SUPABASE_URL` and the secret key must be
 * present in the environment the server starts with. Nothing here deletes data:
 * the only mutation re-saves the settings form with its own values.
 */
export default defineConfig({
  testDir: "./e2e",
  // The suite shares one demo project and its sign-in rate limit.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // A production build hydrates deterministically; the dev server's
        // streaming shell can leave a fresh browser without a React root.
        command: `npm run build && npm run start -- -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
