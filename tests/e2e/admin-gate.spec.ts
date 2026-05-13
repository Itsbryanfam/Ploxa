import { test, expect } from "../fixtures/test-base";

/**
 * T27 — env-gated /admin/reports.
 *
 * The page calls `notFound()` for any viewer not in `ADMIN_USER_IDS`. Test
 * users are seeded with random UUIDs that aren't in the dev env's admin
 * allowlist, so a logged-in non-admin should receive a 404.
 *
 * NOTE: `page.goto()` resolves with the final response after redirects;
 * Next.js renders `notFound()` as an HTTP 404 (verified across earlier
 * Phase 5 specs that hit the privacy gate).
 *
 * The admin-side resolve flow requires `ADMIN_USER_IDS` plumbing for a
 * test user, which is deferred to the T29 manual gate.
 */
test("non-admin GET on /admin/reports returns 404", async ({ page, publicUser }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser.email);
  await page.getByLabel("Password").fill(publicUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  const response = await page.goto("/admin/reports");
  expect(response?.status()).toBe(404);
});
