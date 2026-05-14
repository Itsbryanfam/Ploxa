"use client";

import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";

import { FilterChips } from "@/components/recs/filter-chips";
import { MascotPrompt } from "@/components/recs/mascot-prompt";
import { RecCard } from "@/components/recs/rec-card";
import { MOODS, TIMES, type Mood, type TimeBudget } from "@/lib/recs/moods";
import { getRecs, refillRecs, type RecResult } from "@/lib/recs/server-actions";

type Platform = "steam" | "xbox" | "psn";
type Step = "time" | "mood" | "platform" | "done";

/**
 * 3-step filter flow + results renderer for /play-next.
 *
 * Step transitions (time → mood → platform → done) advance via URL
 * params so a deep link like `/play-next?time=1hr&moods=chill&platforms=steam`
 * lands directly on the results view. `editingStep` is computed from
 * the URL on first mount; click on any pill in the results view sends
 * the user back to that step.
 *
 * Recs are fetched when the user enters the `done` step — either by
 * clicking "Show me what to play →" or by mounting with all three URL
 * params already set (the effect below catches the latter). T11/T12
 * will route this through an AI rerank for sharpening/full tiers.
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

  const [time, setTime] = useState<TimeBudget | "">(initTime);
  const [moods, setMoods] = useState<Mood[]>(initMoods);
  const [platforms, setPlatforms] = useState<Platform[]>(
    initPlatforms.length > 0 ? initPlatforms : userConnectedPlatforms,
  );

  // Initial-step heuristic: if all three are present, jump straight to
  // results; otherwise resume at the first missing step.
  const [editingStep, setEditingStep] = useState<Step>(() => {
    if (initTime && initMoods.length > 0 && initPlatforms.length > 0) return "done";
    if (!initTime) return "time";
    if (initMoods.length === 0) return "mood";
    return "platform";
  });

  const [recsState, setRecsState] = useState<RecResult | null>(null);
  const [pending, startTransition] = useTransition();
  // Optimistic dismissal: the parent owns the set so RecCard can fire-and-
  // forget — we drop the rec from `visibleRecs` synchronously, AnimatePresence
  // runs the exit, and the underlying server action resolves in the background.
  // Reset on refill so the freshly-rebuilt grid renders cleanly.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const loadRecs = useCallback(
    (t: TimeBudget, m: Mood[], p: Platform[]) => {
      startTransition(async () => {
        const result = await getRecs({ time: t, moods: m, platforms: p });
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

  const onRefill = useCallback(() => {
    if (!time || moods.length === 0 || platforms.length === 0) return;
    startTransition(async () => {
      const next = await refillRecs({ time, moods, platforms });
      setRecsState(next);
      setDismissedIds(new Set());
    });
  }, [time, moods, platforms]);

  // Auto-fetch on deep-link mount: when the user lands directly in `done`
  // (all three URL params present), kick the action once. The exhaustive
  // deps eslint rule wants every dep but we intentionally fire-once here;
  // subsequent results refresh happens via the editing-step button flow.
  useEffect(() => {
    if (
      editingStep === "done" &&
      recsState === null &&
      time &&
      moods.length > 0 &&
      platforms.length > 0
    ) {
      loadRecs(time, moods, platforms);
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

  function syncUrl(next: {
    time?: TimeBudget | "";
    moods?: Mood[];
    platforms?: Platform[];
  }) {
    const sp = new URLSearchParams();
    const t = next.time ?? time;
    const m = next.moods ?? moods;
    const p = next.platforms ?? platforms;
    if (t) sp.set("time", t);
    if (m.length > 0) sp.set("moods", m.join(","));
    if (p.length > 0) sp.set("platforms", p.join(","));
    router.replace(`${pathname}?${sp.toString()}`);
  }

  // Step 1 — TIME
  if (editingStep === "time") {
    return (
      <MascotPrompt mood="pointing">
        <p className="mb-4 text-sm">How long do you have?</p>
        <FilterChips
          options={TIMES}
          selected={time ? [time] : []}
          onChange={(next) => {
            const t = next[0];
            if (!t) return;
            setTime(t);
            syncUrl({ time: t });
            setEditingStep("mood");
          }}
        />
      </MascotPrompt>
    );
  }

  // Step 2 — MOOD
  if (editingStep === "mood") {
    return (
      <>
        <FilterPills
          time={time}
          moods={moods}
          platforms={platforms}
          onEdit={setEditingStep}
        />
        <MascotPrompt mood="pointing">
          <p className="mb-4 text-sm">Mood? (pick up to 2)</p>
          <FilterChips
            options={MOODS}
            selected={moods}
            onChange={(next) => {
              setMoods(next);
              syncUrl({ moods: next });
            }}
            multi
            max={2}
          />
          <button
            type="button"
            disabled={moods.length === 0}
            onClick={() => setEditingStep("platform")}
            className="mt-4 rounded bg-[var(--accent)] px-4 py-2 font-mono text-sm text-[var(--accent-fg)] hover:bg-[var(--accent)]/90 disabled:opacity-50"
          >
            Continue →
          </button>
        </MascotPrompt>
      </>
    );
  }

  // Step 3 — PLATFORM
  if (editingStep === "platform") {
    return (
      <>
        <FilterPills
          time={time}
          moods={moods}
          platforms={platforms}
          onEdit={setEditingStep}
        />
        <MascotPrompt mood="pointing">
          <p className="mb-4 text-sm">Platform?</p>
          <FilterChips
            options={userConnectedPlatforms}
            selected={platforms}
            onChange={(next) => {
              setPlatforms(next);
              syncUrl({ platforms: next });
            }}
            multi
            max={userConnectedPlatforms.length}
          />
          <button
            type="button"
            disabled={platforms.length === 0 || !time || moods.length === 0}
            onClick={() => {
              setEditingStep("done");
              if (time && moods.length > 0 && platforms.length > 0) {
                loadRecs(time, moods, platforms);
              }
            }}
            className="mt-4 rounded bg-[var(--accent)] px-4 py-2 font-mono text-sm text-[var(--accent-fg)] hover:bg-[var(--accent)]/90 disabled:opacity-50"
          >
            Show me what to play →
          </button>
        </MascotPrompt>
      </>
    );
  }

  // Results view
  return (
    <>
      <FilterPills
        time={time}
        moods={moods}
        platforms={platforms}
        onEdit={setEditingStep}
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
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
                ? "Couldn’t find a fit for that exact combo. Try widening the time window or different platforms."
                : "Something went wrong."}
          </p>
        </MascotPrompt>
      )}
    </>
  );
}

function FilterPills({
  time,
  moods,
  platforms,
  onEdit,
}: {
  time: TimeBudget | "";
  moods: Mood[];
  platforms: Platform[];
  onEdit: (step: Step) => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap gap-2 text-xs">
      <Pill label={`Time: ${time || "—"}`} onClick={() => onEdit("time")} />
      <Pill
        label={`Mood: ${moods.length > 0 ? moods.join(" + ") : "—"}`}
        onClick={() => onEdit("mood")}
      />
      <Pill
        label={`Platform: ${platforms.length > 0 ? platforms.join(", ") : "—"}`}
        onClick={() => onEdit("platform")}
      />
    </div>
  );
}

function Pill({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[var(--border)] px-3 py-1 hover:border-[var(--border-hover)]"
    >
      {label} <span className="ml-1 opacity-50">✎</span>
    </button>
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
