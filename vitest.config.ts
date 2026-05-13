import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Vitest config. Mirrors the `@/*` path alias from tsconfig.json so test
 * imports work the same way production code does.
 *
 * Test layout:
 *   tests/unit/         — pure-function tests, no mocks needed
 *   tests/integration/  — server-side helpers tested against in-memory mocks
 *                         (redis, db); no real Supabase or Upstash hit
 *
 * Playwright E2E lives in tests/e2e/* and is run by playwright.config.ts,
 * not vitest — the `exclude` below keeps vitest from trying to run those.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.ts", "app/**/*.ts", "components/**/*.tsx"],
      exclude: ["**/*.d.ts", "**/node_modules/**"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
      // The `server-only` package throws unconditionally when imported
      // outside an RSC server runtime. Vitest is plain Node, so anything
      // it loads that begins with `import "server-only"` would error
      // before its tests can run. Swap in a no-op stub — tests are
      // already running on the server side by definition.
      "server-only": resolve(__dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
});
