import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Load the same .env Next loads so test fixtures can reach Supabase via
// the service-role key. dotenv.config() is a no-op if .env is missing.
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

/**
 * Playwright config.
 *
 * Tests live in tests/e2e/ — Vitest excludes that directory in
 * vitest.config.ts so the two suites don't fight over the same files.
 *
 * The dev server is auto-started by Playwright via `webServer`. On CI you
 * would point `baseURL` at a deployed preview, but locally we run against
 * `pnpm dev` so test data writes land in the same Supabase dev project the
 * user is iterating on. Test users carry the `pw_test_` username prefix
 * so they're easy to identify and the suite tears them down per-test.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // tests touch shared DB rows; serialize for clarity
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    // Crawlers (Twitter, Discord) send no cookies. Mirror that for the
    // OG/metadata leak tests — explicit per-test override re-enables
    // cookies for owner-on-own-URL cases.
    extraHTTPHeaders: {
      "user-agent": "playwright-e2e",
    },
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
