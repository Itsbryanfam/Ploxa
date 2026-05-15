import { test, expect } from "../fixtures/test-base";
import { seedReview, SEED_GAME_ID } from "../fixtures/seed-test-users";

test("comment with 3+ URLs is auto-flagged, hidden from non-author, visible to author with badge", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  const seeded = await seedReview({
    userId: publicUser2.userId,
    gameId: SEED_GAME_ID,
    isPublic: true,
    body: "A pinned test review.\n\nGood.\n\nFine.\n\nVerdict.",
    rating: 8,
  });

  // publicUser signs in and posts spammy comment with 3 URLs (link_density rule)
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser.email);
  await page.locator("#password").fill(publicUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  await page.goto(`/u/${publicUser2.username}/reviews/${seeded.gameSlug}`);
  const spam = "Check https://a.com https://b.com https://c.com NOW";
  await page.getByPlaceholder(/Write a comment/i).fill(spam);
  await page.getByRole("button", { name: /^Post$/i }).first().click();

  // Author (commenter) sees the comment + flagged badge
  await expect(page.getByText(spam)).toBeVisible();
  await expect(page.getByText(/Pending review/i)).toBeVisible();

  // Switch to publicUser2 (review author) — clear cookies then re-login
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser2.email);
  await page.locator("#password").fill(publicUser2.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  // publicUser2 visits their own review; the flagged comment is NOT visible.
  await page.goto(`/u/${publicUser2.username}/reviews/${seeded.gameSlug}`);
  await expect(page.getByText(spam)).not.toBeVisible();
});
