import Link from "next/link";
import { notFound } from "next/navigation";

import { LibraryShelf } from "@/components/library/library-shelf";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { ProfileOverviewHeader } from "@/components/social/profile-overview-header";
import { getProfileSummary } from "@/lib/social/_shared/profile-summary";
import { getCachedUser } from "@/lib/supabase/auth-cache";

/**
 * Profile overview hub. Replaces the Phase 1 manual-query baseline with a
 * single getProfileSummary() call that runs all six sections (stats, taste
 * snippet, top lists, recent reviews, library truncated to 12, follower
 * counts) in parallel inside the loader.
 *
 * Returning null from the loader maps to notFound() here — that preserves
 * the "indistinguishable 404" privacy contract for not-found / private +
 * non-owner / blocked-pair viewers. Don't reorder these branches without
 * re-verifying the privacy invariants the loader's tests pin.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const user = await getCachedUser();
  const summary = await getProfileSummary(username, user?.id ?? null);
  if (!summary) notFound();

  const {
    profile,
    stats,
    tasteSnippet,
    topLists,
    recentReviews,
    libraryTruncated,
    isOwner,
    isFollowing,
    followerCount,
    followingCount,
  } = summary;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">
      <ProfileOverviewHeader
        profile={{
          userId: profile.userId,
          username: profile.username,
          displayName: profile.displayName,
          bio: profile.bio,
          avatarUrl: profile.avatarUrl,
        }}
        isOwner={isOwner}
        isViewerLoggedIn={Boolean(user)}
        isFollowing={isFollowing}
        followerCount={followerCount}
        followingCount={followingCount}
      />

      <StatsStrip stats={stats} />

      {tasteSnippet && (
        <section>
          <SectionHeader title="Taste" href={`/u/${username}/taste`} />
          <p className="text-sm text-[var(--text-dim)]">
            {tasteSnippet.narrative ?? "Taste evolving…"}
          </p>
        </section>
      )}

      {topLists.length > 0 && (
        <section>
          <SectionHeader title="Lists" href={`/u/${username}/lists`} />
          <ul className="space-y-1">
            {topLists.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/u/${username}/lists/${l.slug}`}
                  className="text-sm hover:underline"
                >
                  {l.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recentReviews.length > 0 && (
        <section>
          <SectionHeader
            title="Recent reviews"
            href={`/u/${username}/reviews`}
          />
          <ul className="space-y-2">
            {recentReviews.map((r) => (
              <li key={r.id} className="text-sm">
                <Link
                  href={`/u/${username}/reviews/${r.gameSlug}`}
                  className="font-medium hover:underline"
                >
                  {r.gameTitle}
                </Link>
                {r.rating ? (
                  <span className="ml-2 text-[var(--text-dim)]">
                    {r.rating}/10
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHeader title="Library" href={`/u/${username}/library`} />
        <ShelfFrame>
          <LibraryShelf items={libraryTruncated} filter="all" />
        </ShelfFrame>
      </section>
    </div>
  );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div className="flex items-baseline justify-between mb-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Link
        href={href}
        className="text-sm text-[var(--text-dim)] hover:text-[var(--text)]"
      >
        See all →
      </Link>
    </div>
  );
}
