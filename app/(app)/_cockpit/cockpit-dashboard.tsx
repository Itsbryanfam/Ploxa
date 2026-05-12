import Link from "next/link";

import { getUserLibrary, type ActivityEvent } from "@/lib/logs/server-actions";
import { computeUserStatsFromLibrary, type LibraryItem } from "@/lib/logs/library-item";
import { MascotGreeting } from "@/components/dashboard/mascot-greeting";
import { StatusStacks } from "@/components/library/status-stacks";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { ActivityTimeline } from "@/components/dashboard/activity-timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { Mascot } from "@/components/mascot/mascot";
import { copy, type GreetingContext } from "@/lib/mascot/copy";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getFingerprint } from "@/lib/taste/server-actions";

/**
 * Derive the recent-activity feed from an already-fetched library array,
 * avoiding a second DB round-trip on /home. The first 10 items of library
 * (caller must pass a library sorted desc by updatedAt — `getUserLibrary({})`
 * satisfies this) ARE the activity feed.
 *
 * `getRecentActivity()` in server-actions.ts is the standalone DB version,
 * kept for future callers that don't have a pre-loaded library.
 */
function computeRecentActivityFromLibrary(items: LibraryItem[]): ActivityEvent[] {
  return items.slice(0, 10).map((item) => ({
    type: "logged" as const,
    logId: item.logId,
    status: item.status,
    rating: item.rating,
    gameTitle: item.game.title,
    gameSlug: item.game.slug,
    at: item.updatedAt,
  }));
}

export async function CockpitDashboard() {
  // Parallelize the three independent reads. `getCachedUser` is request-
  // memoized so the auth context is shared across all three calls; the
  // network cost is library + fingerprint.
  const [me, library] = await Promise.all([getCachedUser(), getUserLibrary({})]);
  // `getFingerprint` requires a userId; bail to "empty" if we somehow have
  // no session here (the parent page route already redirects unauth users,
  // so this is belt-and-braces).
  const fp = me ? await getFingerprint(me.id) : null;
  const stats = computeUserStatsFromLibrary(library);
  const activity = computeRecentActivityFromLibrary(library);

  // Build greeting context — Date.now() is safe in an async server component;
  // the purity rule is a false positive here (no re-render lifecycle on server).
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const playing = library.find((l) => l.status === "playing");
  const lastLog = library[0]; // already sorted by recent
  const greetingCtx: GreetingContext = {
    // null = decide client-side. Vercel runs server-side in UTC, so a
    // server-derived getHours() returns UTC — wrong "morning/night"
    // greeting for every non-UTC user. MascotGreeting resolves this
    // against the browser's local tz once it mounts.
    hour: null,
    daysSinceLastLog: lastLog
      ? Math.floor((now - new Date(lastLog.updatedAt).getTime()) / 86_400_000)
      : null,
    currentlyPlaying: playing
      ? {
          title: playing.game.title,
          daysSinceStarted: playing.startedAt
            ? Math.floor((now - new Date(playing.startedAt).getTime()) / 86_400_000)
            : 0,
        }
      : null,
  };

  if (library.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-16">
        <EmptyState
          mood="pointing"
          title={copy("library.empty.all")}
          body="Press ⌘K to log your first game."
        />
      </div>
    );
  }

  // Show the rec card only when there's enough signal to recommend against.
  // `empty` tier means no logs in the fingerprint pipeline; the early return
  // above already covers library.length === 0, so this gate catches the in-
  // between case where logs exist but the fingerprint row hasn't been
  // populated yet.
  const showRecsCard = fp != null && fp.tier !== "empty";

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">
      <MascotGreeting context={greetingCtx} />
      <StatsStrip stats={stats} />
      {showRecsCard && (
        <Link
          href="/play-next"
          className="group flex items-center gap-4 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] p-4 transition-colors hover:border-[var(--accent-soft)]"
        >
          <Mascot mood="pointing" size="md" silent />
          <div className="flex-1">
            <h3 className="font-mono text-sm text-[var(--text)]">What should I play?</h3>
            <p className="mt-1 text-xs text-[var(--text-faint)]">
              Pick a time and mood — I&apos;ll suggest five.
            </p>
          </div>
          <span
            aria-hidden
            className="font-mono text-emerald-400 transition-transform group-hover:translate-x-1"
          >
            →
          </span>
        </Link>
      )}
      <StatusStacks items={library} />
      {activity.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-3 text-[var(--text)]">Recent activity</h2>
          <ActivityTimeline events={activity} />
        </section>
      )}
    </div>
  );
}
