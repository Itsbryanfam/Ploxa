import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/test-base";
import {
  seedLogs,
  seedFollow,
  type TestUser,
} from "../fixtures/seed-test-users";

/**
 * T20 — Playwright coverage for the /play-next v2 redesign flow.
 *
 * Two serial tests keep the suite fast under `pnpm dev` (first-compile is
 * the dominant cost). They exercise the always-live redesign screen:
 *   1. core flow — grid renders, the time filter-chip popover edits in
 *      place and rewrites the URL, the mood chip enforces its max-2 cap,
 *      and a refinement adds/removes an active pill (URL round-trip).
 *   2. dismiss split-menu opens, the wildcard slot is visually
 *      identifiable, and a single comma-bearing ?refine= deep link
 *      round-trips as exactly ONE pill (not split on the comma).
 *
 * Carry-forward regressions folded in here (deferred to this E2E by the
 * earlier tasks that shipped these components with no-DOM unit setups):
 *   - initial paint shows the "thinking" mascot prompt before any cards;
 *   - the mood filter chip caps multi-select at 2;
 *   - a single `?refine=a, b` key is read as ONE refinement (the
 *     deliberate comma-split bug fix), proven by a deep-link round-trip.
 *
 * Feasibility notes (verified against the shipped code, NOT the plan):
 *   - v2 getRecs degrades gracefully: with the rerank Edge Function
 *     unreachable locally it falls back to metadata-only matching with an
 *     "AI ranking unavailable" banner, so the grid still renders.
 *   - The rich-fixture happy path (13 logged games, default filters)
 *     deterministically returns EXACTLY 6 cards via metadataOnlyRecs
 *     (GRID_SIZE=6 = 3 Comfort + Backlog + Friends + Wildcard). The pipeline
 *     is: top-200 by rawgRating → minus ≤13 logged → slice 50 → time/platform
 *     filter → slice GRID_SIZE(6). Determinism comes from 200≫50≫6, NOT from
 *     catalog size. We assert === 6 here. The thin-pool / degradation path
 *     (< 6 feasible candidates after time/platform filtering) is legitimately
 *     allowed to yield fewer — it is NOT tested in this rich-fixture scenario.
 *   - There is no library/dismissed-recs seed helper and the bucket
 *     pipeline does not guarantee a wildcard slot in every pool, so the
 *     wildcard assertion is conditional (only asserted when a wildcard
 *     slot is present in this run).
 *
 * First-compile under `pnpm dev` makes the plan's "<30s" a best-effort
 * target, not a hard gate here (T21 measures timing formally); the
 * per-test timeout is generous accordingly.
 */

test.describe.configure({ mode: "serial" });

/**
 * Log in via the password form and wait for the /home redirect. Uses the
 * input ids (not getByLabel) so we never accidentally match the
 * "Use magic link instead of password" toggle, whose accessible name also
 * contains "password" (same approach as phase6-pageant.spec.ts).
 */
async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/home/);
}

test("core flow: grid, time filter, refinement add/remove, mood cap", async ({
  page,
  publicUser,
  publicUser2,
}) => {
  // First-compile under `pnpm dev` plus the AI-rerank fallback path make a
  // tight timeout flaky; this is intentionally generous (T21 owns timing).
  test.setTimeout(45_000);

  // Seed BEFORE navigating. 13 is the max distinct rows (unique index on
  // (user_id, game_id, is_replay)); spread across the Jan–May window so
  // the aggregator counts them and the user lands above the empty tier.
  await seedLogs({
    userId: publicUser.userId,
    count: 13,
    startDate: "2026-01-01",
    endDate: "2026-05-01",
  });
  // Best-effort "friends played" signal — give publicUser2 some logs and
  // have publicUser follow them. Not hard-asserted (the bucket pipeline
  // does not guarantee a friends-slot card in every pool).
  await seedLogs({
    userId: publicUser2.userId,
    count: 13,
    startDate: "2026-01-01",
    endDate: "2026-05-01",
  });
  await seedFollow({
    followerId: publicUser.userId,
    followedId: publicUser2.userId,
  });

  await loginAs(page, publicUser);
  await page.goto("/play-next");

  // Initial-paint carry-forward: while recsState is null the page renders a
  // MascotPrompt mood="thinking" (a mascot image + a "thinking" copy line)
  // and NO rec cards. Asserting "no card at t0" is racy, so assert the
  // thinking copy is present as the pre-grid signal (loose match — the
  // exact string is filter-derived and not worth over-fitting), then use
  // the first rec card becoming visible as the positive grid-rendered
  // signal.
  await expect(
    page.getByText(/picking your hour|one moment|scanning for|finding something|plotting a/i),
  ).toBeVisible({ timeout: 10_000 });

  const cards = page.locator('[data-testid="rec-card"]');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  // Rich-fixture assertion: 13 logged games → top-200 popular pool minus ≤13
  // logged → slice 50 → default-filter attrition still ≥ GRID_SIZE →
  // metadataOnlyRecs deterministically fills all 6. Determinism comes from
  // 200≫50≫6, NOT catalog size. Thin-pool / degradation paths (< 6 feasible
  // candidates) are allowed to yield fewer — NOT exercised by this seed.
  expect(await cards.count()).toBe(6);

  // Time filter chip: opens an inline popover; picking a value auto-closes
  // it and rewrites the URL (?time=<value> via window.history.replaceState —
  // the client owns its own refetch, so a router.replace RSC nav would be
  // redundant and would defer the URL commit behind the slow getRecs
  // transition; see _client.tsx syncUrl).
  await page.getByTestId("filter-chip-time").click();
  await expect(page.getByTestId("filter-chip-option-15min")).toBeVisible();
  await page.getByTestId("filter-chip-option-15min").click();
  await expect(page).toHaveURL(/[?&]time=15min/);

  // Mood max-2 carry-forward. Default moods = ["chill"] (1 selected). The
  // mood popover does NOT auto-close (so a 2nd pick is possible), so we can
  // click within it across selections.
  await page.getByTestId("filter-chip-mood").click();
  await expect(page.getByTestId("filter-chip-option-challenged")).toBeVisible();
  // Select a 2nd mood → now at the cap of 2.
  await page.getByTestId("filter-chip-option-challenged").click();
  // A third, non-selected option must now be disabled.
  await expect(
    page.getByTestId("filter-chip-option-story-driven"),
  ).toBeDisabled();
  // Deselect the 2nd mood → back to 1; the third option re-enables.
  await page.getByTestId("filter-chip-option-challenged").click();
  await expect(
    page.getByTestId("filter-chip-option-story-driven"),
  ).toBeEnabled();
  // Close the mood popover before moving on (it stays open by contract).
  await page.getByTestId("filter-chip-mood").click();

  // Refinement add: type + submit. URLSearchParams owns the encoding, so a
  // space becomes "+" (tolerate "%20" too defensively); the active pill
  // appears with the verbatim text.
  await page.getByTestId("refinement-input").fill("less grindy");
  await page.getByTestId("refinement-submit").click();
  await expect(page).toHaveURL(/[?&]refine=less(\+|%20)grindy/);
  await expect(
    page.getByTestId("refinement-remove-less grindy"),
  ).toBeVisible();

  // Refinement remove: clicking the pill's remove button drops it from the
  // active set and clears the refine key from the URL entirely.
  await page.getByTestId("refinement-remove-less grindy").click();
  await expect(page).not.toHaveURL(/[?&]refine=/);
  await expect(
    page.getByTestId("refinement-remove-less grindy"),
  ).toHaveCount(0);
});

test("dismiss split menu + wildcard slot + deep-link comma round-trip", async ({
  page,
  publicUser,
}) => {
  test.setTimeout(45_000);

  await seedLogs({
    userId: publicUser.userId,
    count: 13,
    startDate: "2026-01-01",
    endDate: "2026-05-01",
  });

  await loginAs(page, publicUser);
  await page.goto("/play-next");

  const cards = page.locator('[data-testid="rec-card"]');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });

  // Dismiss split menu: the dismiss trigger lives inside the card; clicking
  // it opens a popover with the two-way split (snooze / never again).
  await cards.first().getByTestId("rec-card-dismiss").click();
  const snooze = page.getByTestId("rec-card-snooze");
  const never = page.getByTestId("rec-card-never");
  await expect(snooze).toBeVisible();
  await expect(snooze).toHaveText(/not for me/i);
  await expect(never).toBeVisible();
  await expect(never).toHaveText(/never show this again/i);

  // Wildcard slot (conditional — the bucket pipeline does not guarantee a
  // wildcard in every pool). When present, its SlotBadge text is exactly
  // "Wildcard"; the data-slot attribute we added to the card root makes it
  // selectable regardless of the result set.
  const wildcard = page.locator('[data-slot="wildcard"]');
  if ((await wildcard.count()) > 0) {
    await expect(wildcard.first()).toContainText("Wildcard");
  }

  // Deep-link comma round-trip carry-forward: a SINGLE ?refine= key with a
  // literal comma must be read as ONE refinement (the deliberate comma-
  // split bug fix), not split into two pills.
  await page.goto(
    "/play-next?refine=" + encodeURIComponent("cozy, short"),
  );
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });
  const removeBtns = page.locator(
    '[data-testid^="refinement-remove-"]',
  );
  await expect(removeBtns).toHaveCount(1);
  await expect(
    page.getByTestId("refinement-remove-cozy, short"),
  ).toBeVisible();
});
