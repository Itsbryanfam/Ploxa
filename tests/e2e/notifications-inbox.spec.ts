import { test, expect } from "../fixtures/test-base";

/**
 * T19 — full inbox loop:
 *  1. Recipient sees 0 unread before any action
 *  2. Actor performs a follow (T15 surface, T18 emit chokepoint)
 *  3. Recipient's inbox now has the row + "1 unread"
 *  4. Mark-all-read clears to "0 unread"
 *
 * User-switching uses context.clearCookies() rather than /api/auth/signout —
 * the latter route doesn't exist (the AppHeader's profile dropdown uses a
 * server-action logout). Same pattern as auto-flag.spec.ts.
 */

test("action triggers notification + bell badge updates + mark-all-read works", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  // Sign in as publicUser2 (the recipient) to confirm zero starting state.
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser2.email);
  await page.locator("#password").fill(publicUser2.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  await page.goto("/notifications");
  await expect(page.getByText("0 unread")).toBeVisible();

  // Switch to publicUser and trigger a follow.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser.email);
  await page.locator("#password").fill(publicUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  await page.goto(`/u/${publicUser2.username}`);
  await page.getByRole("button", { name: /^Follow$/i }).click();
  // The optimistic flip happens synchronously; the actual server INSERT
  // (and resulting notification emit) runs inside startTransition. We
  // need both:
  //  1. Following label visible (optimistic flip happened)
  //  2. Button no longer disabled (transition's pending flag cleared,
  //     which means the server action's await chain — including emit() —
  //     has resolved).
  const followingBtn = page.getByRole("button", { name: /Following/i });
  await expect(followingBtn).toBeVisible();
  await expect(followingBtn).toBeEnabled();

  // Switch back to publicUser2 and check the inbox.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser2.email);
  await page.locator("#password").fill(publicUser2.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  await page.goto("/notifications");
  await expect(page.getByText("1 unread")).toBeVisible();
  await expect(
    page.getByText(`@${publicUser.username} started following you`),
  ).toBeVisible();

  // Mark all read.
  await page.getByRole("button", { name: /^Mark all read$/i }).click();
  await expect(page.getByText("0 unread")).toBeVisible();
});
