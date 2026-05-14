import Link from "next/link";
import { notFound } from "next/navigation";

import { FollowersGrid } from "@/components/social/followers-grid";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { FOLLOWS_PAGE_SIZE } from "@/lib/social/follows/pagination";
import { getFollowing } from "@/lib/social/follows/server-actions";
import { getCachedUser } from "@/lib/supabase/auth-cache";

interface SearchParams {
  page?: string;
}

/**
 * Following list for @{username}. Mirrors the followers route — same
 * privacy gate, same block filtering, only the loader and header copy
 * differ.
 *
 * Pagination (audit T12): paged via `?page=N` (1-indexed) using the
 * default FOLLOWS_PAGE_SIZE per page. Same N+1 sentinel pattern as the
 * followers route.
 */
export default async function FollowingPage({
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

  const page = Math.min(Math.max(1, Number(pageParam) || 1), 1000);
  const offset = (page - 1) * FOLLOWS_PAGE_SIZE;

  const fetched = await getFollowing(profile.userId, viewer?.id ?? null, {
    limit: FOLLOWS_PAGE_SIZE + 1,
    offset,
  });
  const hasMore = fetched.length > FOLLOWS_PAGE_SIZE;
  const following = hasMore ? fetched.slice(0, FOLLOWS_PAGE_SIZE) : fetched;

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">
          @{profile.username} is following
        </h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          {page > 1 ? `Page ${page} · ` : ""}
          {following.length}{" "}
          {following.length === 1 ? "person" : "people"}
        </p>
      </header>
      <FollowersGrid users={following} emptyText="Not following anyone yet." />
      {(page > 1 || hasMore) && (
        <nav
          aria-label="Pagination"
          className="flex justify-between items-center pt-4"
        >
          {page > 1 ? (
            <Link
              href={
                page === 2
                  ? `/u/${profile.username}/following`
                  : `/u/${profile.username}/following?page=${page - 1}`
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
              href={`/u/${profile.username}/following?page=${page + 1}`}
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
