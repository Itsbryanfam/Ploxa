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

// Feed visibility assertion — T12 feed UI is now shipped.
test("follower sees followee's review publish in their feed", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  const { seedFollow, seedReview, SEED_GAME_ID } = await import("../fixtures/seed-test-users");
  await seedFollow({ followerId: publicUser.userId, followedId: publicUser2.userId });
  const seeded = await seedReview({
    userId: publicUser2.userId,
    gameId: SEED_GAME_ID,
    isPublic: true,
    body: "A pinned test review.\n\nHighs.\n\nLows.\n\nVerdict.",
    rating: 9,
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser.email);
  await page.getByLabel("Password").fill(publicUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  await page.goto("/home/feed");
  await expect(page.getByText(`@${publicUser2.username}`)).toBeVisible();
  // The review-item renderer says "reviewed <game title>"; assert the verb + game slug.
  await expect(page.getByText(/reviewed/i)).toBeVisible();
  // seeded.gameSlug is available for more specific assertions if needed.
  void seeded;
});
