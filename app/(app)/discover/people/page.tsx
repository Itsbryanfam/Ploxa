import { notFound } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getSimilarUsers } from "@/lib/social/discovery/similar-users";
import { SimilarUsersRow } from "@/components/discovery/similar-users-row";
import { Mascot } from "@/components/mascot/mascot";

export const metadata = {
  title: "People with similar taste — Letterboxd for Games",
  description: "Find players whose taste overlaps with yours.",
  robots: { index: false, follow: false },
};

/**
 * Auth-gated similar-users page. notFound() is intentional rather than a
 * redirect to /login: the page is auth-gated AND personalized, so even
 * exposing a 401 redirect would leak that the resource exists. From a
 * logged-out viewer's perspective, /discover/people simply doesn't.
 *
 * `robots: { index: false, follow: false }` keeps this off search indexes
 * (it's user-specific and would never be useful to a crawler).
 */
export default async function DiscoverPeoplePage() {
  const user = await getCachedUser();
  if (!user) notFound();
  const users = await getSimilarUsers(user.id, 24);
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
          <h2 className="mt-6 text-xl font-semibold">
            Log more games to find your matches
          </h2>
          <p className="mt-2 text-sm text-[var(--text-dim)] max-w-md mx-auto">
            Once you&apos;ve logged at least 10 games we&apos;ll show you players
            whose taste overlaps with yours.
          </p>
        </div>
      ) : (
        <SimilarUsersRow users={users} />
      )}
    </div>
  );
}
