import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Sparkles } from "lucide-react";

import { LibraryShelf } from "@/components/library/library-shelf";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { ProfileOverviewHeader } from "@/components/social/profile-overview-header";
import { getProfileSummary } from "@/lib/social/_shared/profile-summary";
import { getCachedUser } from "@/lib/supabase/auth-cache";

/**
 * Shared (user, summary) loader wrapped in React's cache() so generateMetadata
 * and the page body collapse to one set of queries per request instead of two
 * parallel-but-duplicated chains. Same pattern as the canonical review page.
 *
 * Returns null for the same conditions getProfileSummary returns null for —
 * profile missing, private + non-owner, blocked-pair + non-owner — so both
 * callers can map null to "minimal fallback" / notFound() identically.
 */
const getProfilePageData = cache(async (username: string) => {
  const viewer = await getCachedUser();
  const summary = await getProfileSummary(username, viewer?.id ?? null);
  if (!summary) return null;
  return { viewer, summary };
});

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
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const data = await getProfilePageData(username);
  // Privacy fallback: getProfilePageData returns null for not-found + private +
  // blocked-pair non-owners (matches the page's notFound() branch). Return the
  // root template's bare title so unfurlers can't even tell the username
  // exists — same "indistinguishable 404" contract the page body honors.
  if (!data) return { title: "Ploxa" };
  const { summary } = data;
  const { profile, stats } = summary;
  const subject = profile.displayName ?? profile.username;
  const title = subject;
  const description = `${subject}'s gaming profile — ${stats.byStatus.completed} completed, ${stats.byStatus.playing} playing, ${stats.byStatus.backlog} in backlog`;
  const ogImage = `/og/profile/${profile.username}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [ogImage],
      type: "profile",
      url: `/u/${profile.username}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const data = await getProfilePageData(username);
  if (!data) notFound();
  const { viewer: user, summary } = data;

  const {
    profile,
    stats,
    tasteSnippet,
    topLists,
    recentReviews,
    libraryTruncated,
    currentlyPlaying,
    connections,
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
          profilePictureUrl: profile.profilePictureUrl,
          profilePictureKind: profile.profilePictureKind,
          discordUsername: profile.discordUsername,
        }}
        connections={connections}
        isOwner={isOwner}
        isViewerLoggedIn={Boolean(user)}
        isFollowing={isFollowing}
        followerCount={followerCount}
        followingCount={followingCount}
      />

      <StatsStrip stats={stats} />

      <YearRecapCard
        username={profile.username}
        displayName={profile.displayName ?? profile.username}
        totalLogs={stats.total}
        isOwner={isOwner}
      />

      {currentlyPlaying.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Currently playing</h2>
          <ul className="flex flex-wrap gap-3">
            {currentlyPlaying.map((g) => (
              <li key={g.logId}>
                <Link
                  href={`/games/${g.gameSlug}`}
                  className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-3 hover:border-[var(--accent-soft)] transition-colors"
                >
                  {g.gameCoverUrl ? (
                    <Image
                      src={g.gameCoverUrl}
                      alt=""
                      width={36}
                      height={54}
                      className="rounded shrink-0"
                    />
                  ) : (
                    <div className="w-9 h-[54px] rounded bg-[var(--bg-elev)] shrink-0" />
                  )}
                  <span className="text-sm font-medium">{g.gameTitle}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
          <LibraryShelf items={libraryTruncated} filter="all" maxRows={2} />
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

/**
 * Entry-point card for the year-in-review pageant. Always rendered (privacy
 * gate lives on the destination page, not here). Current year is fixed at
 * render time — past-year exploration is via direct URL, not an in-app
 * year-switcher (matches the explicit out-of-scope decision in the Phase 6
 * spec).
 */
function YearRecapCard({
  username,
  displayName,
  totalLogs,
  isOwner,
}: {
  username: string;
  displayName: string;
  totalLogs: number;
  isOwner: boolean;
}) {
  const currentYear = new Date().getUTCFullYear();
  const heading = isOwner ? "Your year in games" : `${displayName}'s year in games`;
  return (
    <Link
      href={`/u/${username}/year/${currentYear}`}
      className="group flex items-center justify-between gap-4 rounded-xl border border-[var(--accent-soft)] bg-gradient-to-br from-[var(--accent)]/10 via-[var(--bg-card)] to-[var(--bg-card)] p-5 transition-colors hover:border-[var(--accent)]"
    >
      <div className="flex items-center gap-4">
        <div className="rounded-lg bg-[var(--accent)]/20 p-2.5 text-[var(--accent)]">
          <Sparkles className="h-6 w-6" />
        </div>
        <div>
          <p className="text-lg font-semibold text-[var(--text)]">{heading}</p>
          <p className="text-sm text-[var(--text-dim)]">
            {currentYear} recap · {totalLogs.toLocaleString()} games logged
          </p>
        </div>
      </div>
      <span className="text-sm text-[var(--text-dim)] transition-colors group-hover:text-[var(--accent)]">
        View →
      </span>
    </Link>
  );
}
