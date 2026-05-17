"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { FilterChipPopover } from "@/components/recs/filter-chip-popover";
import { MascotPrompt } from "@/components/recs/mascot-prompt";
import { RecCard } from "@/components/recs/rec-card";
import { RefinementInput, MAX_ACTIVE } from "@/components/recs/refinement-input";
import { MOODS, TIMES, type Mood, type TimeBudget } from "@/lib/recs/moods";
import { getRecs, refillRecs, type RecResult } from "@/lib/recs/server-actions";

type Platform = "steam" | "xbox" | "psn";

// Coalesce a burst of rapid filter/refinement changes into one getRecs.
// ~350ms: long enough to swallow quick successive clicks, short enough that
// a single deliberate change still feels responsive.
const LOAD_DEBOUNCE_MS = 350;

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
  // refine is free-text (commas/spaces valid) — read repeated `refine` keys
  // (collision-proof), already decoded once by Next. Do NOT parseCsv here:
  // its `.split(",")` would re-introduce the comma-split bug.
  const rawRefine = initialParams.refine;
  const initRefine = (
    Array.isArray(rawRefine) ? rawRefine : rawRefine ? [rawRefine] : []
  )
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_ACTIVE);

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

  // Monotonic request id for last-write-wins. Rapid filter changes can put
  // several getRecs in flight; only the newest may commit state (Next
  // serializes Server Actions, so an older/slower one can resolve last and
  // would otherwise clobber the grid with a stale selection's results).
  const reqIdRef = useRef(0);
  // Pending debounced load timer (rapid-change coalescing — see scheduleLoad).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRecs = useCallback(
    (t: TimeBudget, m: Mood[], p: Platform[], r: string[], gen: number) => {
      startTransition(async () => {
        try {
          const result = await getRecs(
            { time: t, moods: m, platforms: p },
            { refinements: r },
          );
          if (gen !== reqIdRef.current) return; // superseded by a newer load
          setRecsState(result);
          setDismissedIds(new Set());
        } catch {
          // A thrown/timed-out server action (transient Edge 5xx, a
          // serverless timeout, a DB race) must NOT leave the page pinned
          // on the pending mascot forever. Surface a recoverable error —
          // changing any filter/refinement re-invokes loadRecs.
          if (gen !== reqIdRef.current) return;
          setRecsState({ ok: false, reason: "error" });
          setDismissedIds(new Set());
        }
      });
    },
    [],
  );

  // Debounced wrapper for rapid filter/refinement changes. Each change fires
  // its own getRecs and Next serializes Server Actions, so without coalescing
  // a flurry of quick changes queues N sequential slow reranks and
  // `useTransition`'s `pending` never clears — the page looks locked until a
  // manual refresh (production report 2026-05-15). Collapse rapid changes
  // into ONE load for the settled selection. The chip relabel + URL sync stay
  // immediate (synchronous) — only the data fetch waits out the burst.
  //
  // Generation is bumped HERE at schedule time (not inside loadRecs) so that
  // any in-flight load from a previous scheduleLoad call is immediately
  // invalidated. Without this, an in-flight A could resolve and pass the
  // `gen !== reqIdRef.current` guard while B's debounce is still counting
  // down — causing a ≤350ms stale-card flash (production report 2026-05-16).
  const scheduleLoad = useCallback(
    (t: TimeBudget, m: Mood[], p: Platform[], r: string[]) => {
      const gen = ++reqIdRef.current;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        loadRecs(t, m, p, r, gen);
      }, LOAD_DEBOUNCE_MS);
    },
    [loadRecs],
  );

  // Cancel a queued debounced load on unmount.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
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
    // Deliberate button press — run now, but cancel any queued debounced
    // load and take the newest request id so a slow in-flight load can't
    // clobber the refill result.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const myId = ++reqIdRef.current;
    startTransition(async () => {
      try {
        const next = await refillRecs({ time, moods, platforms });
        if (myId !== reqIdRef.current) return;
        setRecsState(next);
        setDismissedIds(new Set());
      } catch {
        // Same dead-end guard as loadRecs: a thrown refill must not pin the
        // page on the pending mascot. Show the recoverable error state.
        if (myId !== reqIdRef.current) return;
        setRecsState({ ok: false, reason: "error" });
        setDismissedIds(new Set());
      }
    });
  }, [time, moods, platforms]);

  // Auto-fetch on mount: filters always resolve to defaults, so unlike the
  // old deep-link gate this always fires once. The exhaustive-deps rule
  // wants every dep but we intentionally fire-once here; subsequent
  // refreshes happen via the filter-chip / refinement onChange handlers.
  // Bump the generation at initiation (same scheme as scheduleLoad/onRefill)
  // so a fast user-initiated scheduleLoad right after mount correctly
  // supersedes the in-flight mount fetch.
  useEffect(() => {
    if (time && moods.length > 0 && platforms.length > 0) {
      const gen = ++reqIdRef.current;
      loadRecs(time, moods, platforms, refinements, gen);
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
    // Repeated `refine` keys: collision-proof for free-text (commas valid).
    // URLSearchParams owns all percent-encoding — never manually encode.
    sp.delete("refine");
    for (const item of r) sp.append("refine", item);
    // history.replaceState, not router.replace: this component owns its own
    // data refetch (loadRecs runs in the same handler), so a router.replace
    // RSC navigation is redundant — and worse, App Router defers the URL-bar
    // commit until that navigation's transition settles, which here sits
    // behind the slow AI-backed getRecs transition. replaceState updates the
    // URL synchronously for deep-link/share parity without a server round
    // trip; page.tsx still reads searchParams on a fresh load/reload.
    window.history.replaceState(null, "", `${pathname}?${sp.toString()}`);
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
            if (t === timeOrDefault) return; // skip redundant rerank on same-time re-click
            setTime(t);
            syncUrl({ time: t });
            scheduleLoad(t, moodsOrDefault, platformsOrDefault, refinements);
          }}
        />
        <FilterChipPopover
          variant="mood"
          value={moodsOrDefault}
          onChange={(m) => {
            setMoods(m);
            syncUrl({ moods: m });
            if (m.length > 0) {
              scheduleLoad(timeOrDefault, m, platformsOrDefault, refinements);
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
              scheduleLoad(timeOrDefault, moodsOrDefault, p, refinements);
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
          if (nextRefine.join("\n") === refinements.join("\n")) return;
          setRefinements(nextRefine);
          // syncUrl reads `refinements` from closure (stale until the async
          // setState flushes) — pass the override so the URL is correct now.
          syncUrl({ refinements: nextRefine });
          scheduleLoad(timeOrDefault, moodsOrDefault, platformsOrDefault, nextRefine);
        }}
      />

      {(pending || recsState === null) && (
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
                : recsState.reason === "rate-limited"
                  ? "Too many tweaks too fast — give it a minute, then try again."
                  : recsState.reason === "error"
                    ? "Couldn’t load picks just now — change a filter to try again."
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
