import Link from "next/link";
import { notFound } from "next/navigation";

import { FollowersGrid } from "@/components/social/followers-grid";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { FOLLOWS_PAGE_SIZE } from "@/lib/social/follows/pagination";
import { getFollowers } from "@/lib/social/follows/server-actions";
import { getCachedUser } from "@/lib/supabase/auth-cache";

interface SearchParams {
  page?: string;
}

/**
 * Followers list for @{username}. Same privacy contract as the overview
 * hub — private profile + non-owner viewer → 404 (no existence leak).
 * Block-filtering is applied inside getFollowers via withBlockedFilter,
 * so the viewer never sees rows for users they've blocked or been
 * blocked by.
 *
 * Pagination (audit T12): paged via `?page=N` (1-indexed) using the
 * default FOLLOWS_PAGE_SIZE per page. We fetch N+1 rows and check for
 * the sentinel to decide whether to render a "Load more" link — cheaper
 * than running a separate count(*) query just for the next-page check.
 */
export default async function FollowersPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ username }, { page: pageParam }] = await Promise.all([
    params,
    searchParams,
  ]);
  const [profile, viewer] = await Promise.all([
    getProfileByUsername(username),
    getCachedUser(),
  ]);
  if (!profile) notFound();
  if (!profile.isPublic && viewer?.id !== profile.userId) notFound();

  // 1-indexed page — anything non-numeric or <= 0 collapses to page 1.
  // Cap at a generous ceiling so a malicious `?page=10_000_000` doesn't
  // make Postgres scan the index. 1000 pages × 100 = 100k followers,
  // which is well past anything we'll see in real traffic for now.
  const page = Math.min(Math.max(1, Number(pageParam) || 1), 1000);
  const offset = (page - 1) * FOLLOWS_PAGE_SIZE;

  // Fetch limit+1 to detect "has more" without a count(*) query.
  // Slice back to limit before passing to the grid.
  const fetched = await getFollowers(profile.userId, viewer?.id ?? null, {
    limit: FOLLOWS_PAGE_SIZE + 1,
    offset,
  });
  const hasMore = fetched.length > FOLLOWS_PAGE_SIZE;
  const followers = hasMore ? fetched.slice(0, FOLLOWS_PAGE_SIZE) : fetched;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">
          @{profile.username}&apos;s followers
        </h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          {page > 1 ? `Page ${page} · ` : ""}
          {followers.length}{" "}
          {followers.length === 1 ? "person" : "people"}
        </p>
      </header>
      <FollowersGrid users={followers} />
      {(page > 1 || hasMore) && (
        <nav
          aria-label="Pagination"
          className="flex justify-between items-center pt-4"
        >
          {page > 1 ? (
            <Link
              href={
                page === 2
                  ? `/u/${profile.username}/followers`
                  : `/u/${profile.username}/followers?page=${page - 1}`
              }
              className="text-sm text-[var(--text-dim)] hover:text-[var(--text)] underline"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Link
              href={`/u/${profile.username}/followers?page=${page + 1}`}
              className="text-sm text-[var(--text-dim)] hover:text-[var(--text)] underline"
            >
              Load more →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
