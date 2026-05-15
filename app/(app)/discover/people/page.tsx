import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getSimilarUsers } from "@/lib/social/discovery/similar-users";
import { SimilarUsersRow } from "@/components/discovery/similar-users-row";
import { Mascot } from "@/components/mascot/mascot";

export const metadata = {
  title: "People with similar taste",
  description: "Find players whose taste overlaps with yours.",
  robots: { index: false, follow: false },
};

const MIN_LOGS_FOR_MATCHING = 10;

/**
 * Auth-gated similar-users page. notFound() is intentional rather than a
 * redirect to /login: the page is auth-gated AND personalized, so even
 * exposing a 401 redirect would leak that the resource exists. From a
 * logged-out viewer's perspective, /discover/people simply doesn't.
 *
 * `robots: { index: false, follow: false }` keeps this off search indexes
 * (it's user-specific and would never be useful to a crawler).
 *
 * Empty-state copy adapts based on WHY the result set is empty:
 *   - viewer below the 10-log floor → "Log more games to find your matches"
 *   - viewer is fine, candidate pool empty → "We're still growing"
 * The naive single-message version misled users with hundreds of logs into
 * thinking the floor still applied to them.
 */
export default async function DiscoverPeoplePage() {
  const user = await getCachedUser();
  if (!user) notFound();

  const users = await getSimilarUsers(user.id, 24);

  let viewerLogCount = 0;
  if (users.length === 0) {
    const rows = (await db.execute<{ c: number }>(sql`
      SELECT total_logs_at_generation::int AS c
      FROM taste_fingerprints
      WHERE user_id = ${user.id}
      LIMIT 1
    `)) as unknown as Array<{ c: number }>;
    viewerLogCount = rows[0]?.c ?? 0;
  }
  const viewerBelowFloor = viewerLogCount < MIN_LOGS_FOR_MATCHING;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">People with similar taste</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          Ranked by how much your taste fingerprints overlap.
        </p>
      </header>
      {users.length === 0 ? (
        <div className="text-center py-16">
          <Mascot size="lg" mood="thinking" silent />
          {viewerBelowFloor ? (
            <>
              <h2 className="mt-6 text-xl font-semibold">
                Log more games to find your matches
              </h2>
              <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md mx-auto">
                {`Once you've logged at least ${MIN_LOGS_FOR_MATCHING} games we'll show you players whose taste overlaps with yours.`}
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-6 text-xl font-semibold">
                No matches yet — we&apos;re still growing
              </h2>
              <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md mx-auto">
                Your taste is on file, but no one else has logged enough games
                yet for us to match. Check back as more players join.
              </p>
            </>
          )}
        </div>
      ) : (
        <SimilarUsersRow users={users} />
      )}
    </div>
  );
}
