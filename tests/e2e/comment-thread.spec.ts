import { test, expect } from "../fixtures/test-base";
import { seedReview, SEED_GAME_ID } from "../fixtures/seed-test-users";

test("comment + reply + edit + soft-delete preserves thread structure", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  // Seed: publicUser2 publishes a review on the seed game (Penarium).
  const seeded = await seedReview({
    userId: publicUser2.userId,
    gameId: SEED_GAME_ID,
    isPublic: true,
    body: "A pinned test review.\n\nGood.\n\nFine.\n\nVerdict.",
    rating: 8,
  });

  // Sign in as publicUser
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser.email);
  await page.getByLabel("Password").fill(publicUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  // Visit canonical review page, post a top-level comment
  await page.goto(`/u/${publicUser2.username}/reviews/${seeded.gameSlug}`);
  await page.getByPlaceholder(/Write a comment/i).fill("Strong take.");
  await page.getByRole("button", { name: /^Post$/i }).first().click();
  await expect(page.getByText("Strong take.")).toBeVisible();

  // Reply to it
  await page.getByRole("button", { name: /^Reply$/i }).click();
  await page.getByPlaceholder(/Write a reply/i).fill("Agreed.");
  await page.getByRole("button", { name: /^Post$/i }).last().click();
  await expect(page.getByText("Agreed.")).toBeVisible();

  // Edit the top-level comment
  await page.getByRole("button", { name: /^Edit$/i }).first().click();
  const editArea = page.locator("textarea").first();
  await editArea.fill("Strong take, agreed too.");
  await page.getByRole("button", { name: /^Save$/i }).click();
  await expect(page.getByText("Strong take, agreed too.")).toBeVisible();
  await expect(page.getByText("(edited)")).toBeVisible();

  // Soft-delete: handle the confirm() dialog
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /^Delete$/i }).first().click();
  await expect(page.getByText("[deleted]")).toBeVisible();
  // Reply is still visible (thread structure preserved)
  await expect(page.getByText("Agreed.")).toBeVisible();
});
