import { test, expect } from "../fixtures/test-base";

/**
 * T8 — minimal social loop: a logged-in user can follow another user from
 * their profile and the follow-graph reflects it on the followers route.
 *
 * The feed-visibility assertion (publicUser sees publicUser2's review in
 * the home feed) lands in T12 once the feed UI ships — kept here as a
 * test.fixme so the file is the single landing pad for follow-flow
 * coverage and T12 only needs to flip the .fixme off.
 */

test("publicUser can follow publicUser2 and see Following state", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  // Log in as publicUser via the password form.
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser.email);
  await page.getByLabel("Password").fill(publicUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL("/home");

  // Visit publicUser2's profile and click Follow.
  await page.goto(`/u/${publicUser2.username}`);
  await page.getByRole("button", { name: /^Follow$/i }).click();
  // The button's text contains a ✓ glyph after the optimistic flip — use
  // the simpler /Following/ regex to avoid Unicode escaping surprises in
  // Playwright's name matcher.
  await expect(page.getByRole("button", { name: /Following/i })).toBeVisible();

  // Visit publicUser2's followers list and assert publicUser appears.
  await page.goto(`/u/${publicUser2.username}/followers`);
  await expect(page.getByText(`@${publicUser.username}`)).toBeVisible();
});

// Feed visibility assertion lands in T12 — added as a fixme placeholder.
test.fixme(
  "publicUser sees publicUser2's review-publish in feed (T12)",
  async () => {
    // T12 will add the full feed assertion here once feed routes ship.
  },
);
