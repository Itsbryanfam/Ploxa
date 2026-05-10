import { getUserLibrary, getRecentActivity, type UserStats } from "@/lib/logs/server-actions";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { MascotGreeting } from "@/components/dashboard/mascot-greeting";
import { StatusStacks } from "@/components/library/status-stacks";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { ActivityTimeline } from "@/components/dashboard/activity-timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";
import type { GreetingContext } from "@/lib/mascot/copy";
import type { LogStatus } from "@/lib/db/schema-types";

/**
 * Compute UserStats from an already-fetched library array, avoiding a second
 * DB round-trip. getUserStats() in server-actions.ts is kept for future callers
 * that need stats without first fetching the full library.
 */
function computeUserStatsFromLibrary(items: LibraryItem[]): UserStats {
  const byStatus: Record<LogStatus, number> = {
    backlog: 0, playing: 0, completed: 0, dropped: 0, on_hold: 0, wishlist: 0,
  };
  let ratingSum = 0;
  let ratingCount = 0;
  for (const item of items) {
    byStatus[item.status]++;
    if (item.rating != null) {
      ratingSum += item.rating;
      ratingCount++;
    }
  }
  return {
    total: items.length,
    byStatus,
    averageRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : null,
  };
}

export async function CockpitDashboard() {
  const [library, activity] = await Promise.all([
    getUserLibrary({}),
    getRecentActivity(10),
  ]);
  const stats = computeUserStatsFromLibrary(library);

  // Build greeting context — Date.now() is safe in an async server component;
  // the purity rule is a false positive here (no re-render lifecycle on server).
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const playing = library.find((l) => l.status === "playing");
  const lastLog = library[0]; // already sorted by recent
  const greetingCtx: GreetingContext = {
    hour: new Date(now).getHours(),
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">
      <MascotGreeting context={greetingCtx} />
      <StatsStrip stats={stats} />
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
