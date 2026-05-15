import { test, expect } from "../fixtures/test-base";

/**
 * T24 — Lists lifecycle e2e: create, add an item (via AddToListModal on the
 * seeded game page), then visit the canonical user lists page.
 *
 * NOTE: Drag-reorder coverage is deferred to the T29 manual gate (M4).
 * Playwright's page.dragAndDrop() doesn't trigger @dnd-kit's pointer-event
 * sensors reliably. The reorder server action is covered by unit tests and
 * the manual gate checklist.
 *
 * NOTE: The publish step is not exercised here because capturing the dynamic
 * list UUID from the redirected /lists/{uuid}/edit URL requires extra state
 * management that adds fragility. The publish server action is covered by
 * unit tests; the full publish-then-visit flow is part of T29 manual gate.
 */

import { SEED_GAME_ID } from "../fixtures/seed-test-users";

test("create list, add a game via AddToListModal, visit user lists page", async ({
  page,
  publicUser,
}) => {
  void SEED_GAME_ID; // Penarium (id=4) is the seeded game used in other specs.

  // Log in as publicUser via the password form.
  await page.goto("/login");
  await page.getByLabel("Email").fill(publicUser.email);
  await page.locator("#password").fill(publicUser.password);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/home/);

  // Navigate to /lists/new — server creates "Untitled list" and redirects
  // to /lists/{uuid}/edit.
  await page.goto("/lists/new");
  await expect(page).toHaveURL(/\/lists\/[0-9a-f-]+\/edit/);

  // Set the list title (save-on-blur).
  await page.getByPlaceholder("List title").fill("My GOTY 2026");
  await page.getByPlaceholder("List title").blur();

  // Visit the seeded game page (Penarium slug = "penarium").
  await page.goto("/games/penarium");

  // Open the AddToListModal.
  await page.getByRole("button", { name: /add to list/i }).click();

  // The modal should show the newly created list.
  await expect(page.getByText("My GOTY 2026")).toBeVisible();

  // Click the list to add the game.
  await page.getByText("My GOTY 2026").click();

  // After clicking, the button text changes to "Added to My GOTY 2026".
  await expect(page.getByText(/Added to/i)).toBeVisible();

  // Close the modal.
  await page.keyboard.press("Escape");

  // Visit the user's lists page and assert the list is visible.
  await page.goto(`/u/${publicUser.username}/lists`);
  await expect(page.getByText("My GOTY 2026")).toBeVisible();
});
