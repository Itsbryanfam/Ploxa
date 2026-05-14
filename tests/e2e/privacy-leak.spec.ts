import { test, expect } from "../fixtures/test-base";
import { SEED_GAME_ID, seedList, seedReview } from "../fixtures/seed-test-users";

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

// ─────────────────────────────────────────────────────────────────────────
// T23 — same privacy-gate contract for the new /og/profile, /og/list, /og/game
// endpoints. They each live OUTSIDE the (app) route group and are reachable
// by unauthenticated unfurlers, so the same "private profile / private
// resource → 404" rule applies. Lock it in here so a regression that
// silently flipped the gate back to `is_public` only would fail.
// ─────────────────────────────────────────────────────────────────────────

test("OG /og/profile returns 404 for a private profile (T23)", async ({
  privateUser,
  request,
}) => {
  const res = await request.get(`/og/profile/${privateUser.username}`);
  expect(res.status()).toBe(404);
});

test("OG /og/profile serves the card for a public profile (T23 positive)", async ({
  publicUser,
  request,
}) => {
  const res = await request.get(`/og/profile/${publicUser.username}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/image\/png/);
});

test("OG /og/profile returns 404 for an unknown username (T23)", async ({ request }) => {
  // A name that won't match any pw_test_ user. Confirms the route handler
  // doesn't 500 on miss.
  const res = await request.get("/og/profile/no_such_user_pw_test_xyz");
  expect(res.status()).toBe(404);
});

test("OG /og/list returns 404 for a private profile's published list (T23)", async ({
  privateUser,
  request,
}) => {
  // List flagged public + published, but the owning profile is private.
  const list = await seedList({
    userId: privateUser.userId,
    isPublic: true,
    published: true,
  });
  const res = await request.get(`/og/list/${list.listId}`);
  expect(res.status()).toBe(404);
});

test("OG /og/list returns 404 for a public profile's unpublished list (T23)", async ({
  publicUser,
  request,
}) => {
  // Profile is public, list is_public ✓ but published_at NULL.
  // /og/list should mirror the page-level "published or 404" rule.
  const list = await seedList({
    userId: publicUser.userId,
    isPublic: true,
    published: false,
  });
  const res = await request.get(`/og/list/${list.listId}`);
  expect(res.status()).toBe(404);
});

test("OG /og/list returns 404 for a public profile's private list (T23)", async ({
  publicUser,
  request,
}) => {
  const list = await seedList({
    userId: publicUser.userId,
    isPublic: false,
    published: true,
  });
  const res = await request.get(`/og/list/${list.listId}`);
  expect(res.status()).toBe(404);
});

test("OG /og/list serves the card for a public+published list (T23 positive)", async ({
  publicUser,
  request,
}) => {
  const list = await seedList({
    userId: publicUser.userId,
    isPublic: true,
    published: true,
  });
  const res = await request.get(`/og/list/${list.listId}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/image\/png/);
});

test("OG /og/list returns 404 for a non-existent list id (T23)", async ({ request }) => {
  const res = await request.get("/og/list/00000000-0000-4000-8000-000000000000");
  expect(res.status()).toBe(404);
});

test("OG /og/game serves the card for a seeded game slug (T23 positive)", async ({
  request,
}) => {
  // SEED_GAME_ID = 4 → Penarium → slug "penarium" — present in every test DB.
  // Game pages are catalog-public by design (no per-user privacy), so the
  // only failure mode here is "slug not in catalog" → 404.
  void SEED_GAME_ID;
  const res = await request.get("/og/game/penarium");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/image\/png/);
});

test("OG /og/game returns 404 for an unknown slug (T23)", async ({ request }) => {
  // /og/game intentionally does NOT do RAWG-on-miss enrichment — unfurlers
  // shouldn't be able to burn RAWG free-tier quota by sharing a fresh slug.
  // So a never-cached slug must 404 cleanly.
  const res = await request.get("/og/game/no-such-game-slug-xyz-pw-test");
  expect(res.status()).toBe(404);
});
