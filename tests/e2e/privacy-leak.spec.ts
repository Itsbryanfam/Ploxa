import { test, expect } from "../fixtures/test-base";
import { SEED_GAME_ID, seedReview } from "../fixtures/seed-test-users";

/**
 * Regression coverage for audit #1 — the OG endpoint's privacy gate.
 *
 * The OG endpoint at /og/review/[id] lives OUTSIDE the (app) route group,
 * so it's reachable by unauthenticated crawlers (Twitter, Discord, etc.).
 * Before the audit fix it short-circuited only on the review's is_public
 * flag, not on profiles.is_public — a private profile's published-public
 * review would still serve its OG card to unfurlers.
 *
 * Note on audit #2: the canonical review page at /u/[username]/reviews/[slug]
 * lives INSIDE the (app) route group, whose layout calls redirect("/login")
 * for any unauthenticated request. So the "generateMetadata leaks to
 * unfurlers" finding wasn't reachable in production — the layout-level
 * gate fires before generateMetadata can be served. The batch-1 fix to
 * generateMetadata is still in place as defense-in-depth (it would matter
 * the moment the page ever moved out of (app)), but it can't be exercised
 * by an anon HTTP request in the current architecture, so we don't test
 * it here. The page-level notFound() gate (which IS reachable to a
 * logged-in non-owner) is covered by the unit-test suite via the
 * usernameSchema / page-prop type contracts.
 */

test("OG endpoint returns 404 for a private profile's review (audit #1)", async ({
  privateUser,
  request,
}) => {
  const review = await seedReview({
    userId: privateUser.userId,
    gameId: SEED_GAME_ID,
    isPublic: true, // is_public ✓ but owning profile is private
  });
  const res = await request.get(`/og/review/${review.reviewId}`);
  expect(res.status()).toBe(404);
});

test("OG endpoint serves the card for a public profile's review (positive case)", async ({
  publicUser,
  request,
}) => {
  const review = await seedReview({
    userId: publicUser.userId,
    gameId: SEED_GAME_ID,
    isPublic: true,
  });
  const res = await request.get(`/og/review/${review.reviewId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/image\/png/);
});

test("OG endpoint returns 404 for a published but is_public=false review", async ({
  publicUser,
  request,
}) => {
  // Verifies the review-level gate (predates the audit fix) still works:
  // a public profile that ticked the review's is_public flag off should
  // not have its OG card served.
  const review = await seedReview({
    userId: publicUser.userId,
    gameId: SEED_GAME_ID,
    isPublic: false,
  });
  const res = await request.get(`/og/review/${review.reviewId}`);
  expect(res.status()).toBe(404);
});

test("OG endpoint returns 404 for a non-existent review id", async ({ request }) => {
  // Use a well-formed UUID that doesn't exist. Confirms the route handler
  // doesn't 500 on miss — it's a public endpoint, robustness matters.
  const res = await request.get("/og/review/00000000-0000-4000-8000-000000000000");
  expect(res.status()).toBe(404);
});
