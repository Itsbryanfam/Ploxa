"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { FilterChipPopover } from "@/components/recs/filter-chip-popover";
import { MascotPrompt } from "@/components/recs/mascot-prompt";
import { RecCard } from "@/components/recs/rec-card";
import { RefinementInput } from "@/components/recs/refinement-input";
import { MOODS, TIMES, type Mood, type TimeBudget } from "@/lib/recs/moods";
import { getRecs, refillRecs, type RecResult } from "@/lib/recs/server-actions";

type Platform = "steam" | "xbox" | "psn";

/**
 * Live recommendation page for /play-next (play-next redesign, T18).
 *
 * Replaces the old 4-step wizard with a single always-live screen: an
 * always-visible filter-chip row (time / mood / platform) + a freeform
 * `RefinementInput`, above an always-rendered results grid. Filters AND
 * refinements are mirrored to the URL (`?time=&moods=&platforms=&refine=`)
 * so a deep link reproduces the exact view; the grid auto-fetches on mount
 * (filters always have defaults) and re-fetches on any filter/refinement
 * mutation. Every other behavior (empty-tier short-circuit, optimistic
 * dismissal, refill, the RecResult ok/banner/!ok states, pending mascot)
 * is preserved from the pre-redesign client. T11/T12 route sharpening/full
 * tiers through the AI rerank inside getRecs.
 */
export function PlayNextClient({
  initialParams,
  tier,
  userConnectedPlatforms,
}: {
  initialParams: Record<string, string | string[] | undefined>;
  tier: "empty" | "sparse" | "sharpening" | "full";
  userConnectedPlatforms: Platform[];
}) {
  const router = useRouter();
  const pathname = usePathname();

  const initTime = ((): TimeBudget | "" => {
    const v = initialParams.time;
    const s = Array.isArray(v) ? v[0] : v;
    return (TIMES as readonly string[]).includes(s ?? "") ? (s as TimeBudget) : "";
  })();
  const initMoods = parseCsv(initialParams.moods).filter((m): m is Mood =>
    (MOODS as readonly string[]).includes(m),
  );
  const initPlatforms = parseCsv(initialParams.platforms).filter(
    (p): p is Platform => p === "steam" || p === "xbox" || p === "psn",
  );
  const initRefine = parseCsv(initialParams.refine).slice(0, 5);

  // Default filters when absent so the page is always live (acceptance:
  // time="1hr", moods=["chill"], platforms=userConnectedPlatforms). The
  // chip popovers require concrete non-empty values; the URL only carries
  // explicitly-set filters (an unset filter falls back to the default).
  const [time, setTime] = useState<TimeBudget | "">(initTime || "1hr");
  const [moods, setMoods] = useState<Mood[]>(
    initMoods.length > 0 ? initMoods : ["chill"],
  );
  const [platforms, setPlatforms] = useState<Platform[]>(
    initPlatforms.length > 0 ? initPlatforms : userConnectedPlatforms,
  );
  const [refinements, setRefinements] = useState<string[]>(initRefine);

  const [recsState, setRecsState] = useState<RecResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Optimistic dismissal: the parent owns the set so RecCard can fire-and-
  // forget — we drop the rec from `visibleRecs` synchronously, AnimatePresence
  // runs the exit, and the underlying server action resolves in the background.
  // Reset on refill so the freshly-rebuilt grid renders cleanly.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const loadRecs = useCallback(
    (t: TimeBudget, m: Mood[], p: Platform[], r: string[]) => {
      startTransition(async () => {
        const result = await getRecs(
          { time: t, moods: m, platforms: p },
          { refinements: r },
        );
        setRecsState(result);
        setDismissedIds(new Set());
      });
    },
    [],
  );

  const onCardDismissed = useCallback((recId: string) => {
    setDismissedIds((s) => {
      const next = new Set(s);
      next.add(recId);
      return next;
    });
  }, []);

  // Refill = "Show me more like these →". refillRecs only accepts filters
  // (it wipes the non-dismissed cache rows for this filter key and re-runs
  // getRecs WITHOUT refinements — the cumulative dismissed history feeds the
  // rerank's negative context server-side instead). So refill is
  // intentionally filters-only; an active refinement is not re-applied here.
  const onRefill = useCallback(() => {
    if (!time || moods.length === 0 || platforms.length === 0) return;
    startTransition(async () => {
      const next = await refillRecs({ time, moods, platforms });
      setRecsState(next);
      setDismissedIds(new Set());
    });
  }, [time, moods, platforms]);

  // Auto-fetch on mount: filters always resolve to defaults, so unlike the
  // old deep-link gate this always fires once. The exhaustive-deps rule
  // wants every dep but we intentionally fire-once here; subsequent
  // refreshes happen via the filter-chip / refinement onChange handlers.
  useEffect(() => {
    if (time && moods.length > 0 && platforms.length > 0) {
      loadRecs(time, moods, platforms, refinements);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Empty tier short-circuit — the flow is meaningless without any
  // logged games. Mascot points the user to the games index.
  if (tier === "empty") {
    return (
      <MascotPrompt mood="pointing">
        <p className="text-sm">
          Log at least one game and I&apos;ll start recommending. Try{" "}
          <Link href="/games" className="text-[var(--accent)] underline">
            finding something here
          </Link>
          .
        </p>
      </MascotPrompt>
    );
  }

  // Mirror current filter + refinement state to the URL so a deep link
  // reproduces the view. `next` overrides let an onChange push the just-set
  // value without waiting for the async setState to flush.
  function syncUrl(next: {
    time?: TimeBudget | "";
    moods?: Mood[];
    platforms?: Platform[];
    refinements?: string[];
  }) {
    const sp = new URLSearchParams();
    const t = next.time ?? time;
    const m = next.moods ?? moods;
    const p = next.platforms ?? platforms;
    const r = next.refinements ?? refinements;
    if (t) sp.set("time", t);
    if (m.length > 0) sp.set("moods", m.join(","));
    if (p.length > 0) sp.set("platforms", p.join(","));
    if (r.length > 0) sp.set("refine", r.map(encodeURIComponent).join(","));
    router.replace(`${pathname}?${sp.toString()}`);
  }

  // Resolved non-empty values for the chip popovers + refetch calls. `time`
  // state can be "" in principle (init parsing); the default keeps it
  // concrete, but resolve again here so a chip never receives an empty value.
  const timeOrDefault: TimeBudget = time || "1hr";
  const moodsOrDefault: Mood[] = moods.length > 0 ? moods : ["chill"];
  const platformsOrDefault: Platform[] =
    platforms.length > 0 ? platforms : userConnectedPlatforms;

  return (
    <>
      <div className="mb-6 flex flex-wrap gap-2">
        <FilterChipPopover
          variant="time"
          value={timeOrDefault}
          onChange={(t) => {
            setTime(t);
            syncUrl({ time: t });
            loadRecs(t, moodsOrDefault, platformsOrDefault, refinements);
          }}
        />
        <FilterChipPopover
          variant="mood"
          value={moodsOrDefault}
          onChange={(m) => {
            setMoods(m);
            syncUrl({ moods: m });
            if (m.length > 0) {
              loadRecs(timeOrDefault, m, platformsOrDefault, refinements);
            }
          }}
        />
        <FilterChipPopover
          variant="platform"
          value={platforms}
          options={userConnectedPlatforms}
          onChange={(p) => {
            setPlatforms(p);
            syncUrl({ platforms: p });
            if (p.length > 0) {
              loadRecs(timeOrDefault, moodsOrDefault, p, refinements);
            }
          }}
        />
      </div>

      <RefinementInput
        active={refinements}
        onChange={(nextRefine) => {
          // T17: RefinementInput emits the full set on every mutation
          // (remove/clearAll included) and only skips onChange on a no-op
          // commit. Value-dedupe here so an identical array doesn't trigger
          // a redundant getRecs + URL push (refetch loop guard).
          if (nextRefine.join("") === refinements.join("")) return;
          setRefinements(nextRefine);
          // syncUrl reads `refinements` from closure (stale until the async
          // setState flushes) — pass the override so the URL is correct now.
          syncUrl({ refinements: nextRefine });
          loadRecs(timeOrDefault, moodsOrDefault, platformsOrDefault, nextRefine);
        }}
      />

      {pending && (
        <MascotPrompt mood="thinking">
          <p className="text-sm">{pendingCopyFor(time)}</p>
        </MascotPrompt>
      )}
      {!pending && recsState && recsState.ok && (
        <>
          {recsState.banner && (
            <div className="mb-4 rounded-md border border-[var(--border)] bg-[var(--bg)]/50 p-3 text-xs text-[var(--text-dim)]">
              {recsState.banner}
            </div>
          )}
          <MascotPrompt mood="thinking">
            <p className="text-sm">
              {recsState.recs.length}{" "}
              {recsState.recs.length === 1 ? "pick" : "picks"} for you.
            </p>
          </MascotPrompt>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {recsState.recs
                .filter((r) => !dismissedIds.has(r.id))
                .map((r) => (
                  <RecCard
                    key={r.id}
                    rec={r}
                    connectedPlatforms={userConnectedPlatforms}
                    // DB returns `string[] | null` for `games.platforms`. The
                    // values come from the same `platform_kind` enum that
                    // constrains `userConnectedPlatforms`, but TS can't see
                    // that through Drizzle's `text[]` return type — narrow
                    // here with a type predicate so anything that somehow
                    // drifted out of the enum (legacy seed row, etc.) gets
                    // dropped instead of crashing the picker downstream.
                    gamePlatforms={(r.platforms ?? []).filter(
                      (p): p is Platform =>
                        p === "steam" || p === "xbox" || p === "psn",
                    )}
                    onDismissed={onCardDismissed}
                  />
                ))}
            </AnimatePresence>
          </div>
          {dismissedIds.size > 0 && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={onRefill}
                disabled={pending}
                className="rounded border border-[var(--accent)] px-4 py-2 font-mono text-sm text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                Show me more like these →
              </button>
            </div>
          )}
        </>
      )}
      {!pending && recsState && !recsState.ok && (
        <MascotPrompt mood="confused">
          <p className="text-sm">
            {recsState.reason === "empty-tier"
              ? "You don’t have any logs yet — log a game first."
              : recsState.reason === "no-candidates"
                ? "No picks match — try widening your filters or removing a refinement."
                : "Something went wrong."}
          </p>
        </MascotPrompt>
      )}
    </>
  );
}

function parseCsv(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap((s) => s.split(",")).filter(Boolean);
  return v.split(",").filter(Boolean);
}

/**
 * Filter-aware copy for the mascot's "thinking" pose during the AI
 * rerank wait (5–10s). One variant per TimeBudget so the prompt reads
 * as if the mascot is actually scanning for the user's session length.
 * Empty/unknown time falls back to the generic line.
 */
function pendingCopyFor(time: TimeBudget | ""): string {
  switch (time) {
    case "15min":
      return "Scanning for a quick hit…";
    case "1hr":
      return "Picking your hour…";
    case "3hr+":
      return "Finding something for the long evening…";
    case "multi-session":
      return "Plotting a multi-session…";
    default:
      return "One moment — picking your five…";
  }
}
