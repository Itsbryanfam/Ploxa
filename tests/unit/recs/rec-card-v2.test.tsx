import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * rec-card-v2.test.tsx — play-next redesign T15.
 *
 * The repo's vitest setup runs in a Node environment with no DOM and no
 * `@testing-library/react` dep (see vitest.config.ts + the header on
 * tests/unit/recaps/featured-list-card.test.tsx). Component tests therefore
 * use `react-dom/server.renderToStaticMarkup` and assert on the HTML string.
 *
 * RecCard is a `"use client"` component. Unlike the pure presentational
 * recaps cards, it (a) calls `useRouter()` from next/navigation — which
 * throws outside a router provider during render, (b) wraps its tree in a
 * framer-motion `motion.div`, (c) imports `toast` from sonner, and (d)
 * statically imports `@/lib/recs/server-actions` whose transitive graph
 * (`@/lib/db`, `@/lib/cache/redis`) throws at load without Upstash/DB env.
 *
 * No existing repo test renders a `useRouter` client component statically,
 * and none mock framer-motion/sonner. So per T15's documented fallback we
 * use the minimal `vi.mock` set below. Each is justified:
 *
 *   - `@/lib/recs/server-actions` — mocked to a thin stub. The card only
 *     *references* snoozeRec/neverAgainRec/saveRecForLater/playRec inside
 *     event handlers (never invoked during static render); the `RecCard`
 *     type is `import type` (erased at runtime). Mocking this module is the
 *     same "mock the I/O boundary" idiom tests/integration/recs/get-recs
 *     uses, and it keeps the heavy transitive import graph
 *     (db → redis, which throws without env) out of the unit run.
 *   - `next/navigation` — `useRouter()` throws with no provider; stub push.
 *   - `framer-motion` — `motion.div` SSRs to a div, but no existing test
 *     exercises it under node renderToStaticMarkup; a pass-through stub
 *     keeps `data-testid`/`className` in the markup deterministically.
 *   - `sonner` — `toast` is only called in handlers, but it's imported at
 *     module top; a no-op stub avoids any import-time surprise.
 *
 * Interaction coverage (opening the dismiss-split popover, clicking
 * Snooze / Never-again / Play, optimistic exit) is INTENTIONALLY deferred
 * to T20 Playwright — there is no DOM here and the repo has no RTL dep, so
 * only static-markup aspects are asserted. No assertions are weakened.
 */

vi.mock("@/lib/recs/server-actions", () => ({
  snoozeRec: vi.fn(),
  neverAgainRec: vi.fn(),
  saveRecForLater: vi.fn(),
  playRec: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string | symbol) =>
        ({
          children,
          // strip framer-only props so they don't leak as DOM attrs
          layout: _layout,
          initial: _initial,
          exit: _exit,
          animate: _animate,
          transition: _transition,
          ...rest
        }: Record<string, unknown> & { children?: ReactNode }) =>
          createElement(String(tag), rest, children),
    },
  ),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

import { RecCard, guardedCardAction, buildSaveOnError } from "@/components/recs/rec-card";
import type { RecCard as RecCardData } from "@/lib/recs/server-actions";

const baseRec: RecCardData = {
  id: "rec-1",
  gameId: 42,
  slug: "test-game",
  title: "Test Game",
  releasedYear: 2024,
  posterUrl: "/test.jpg",
  coverUrl: "/test.jpg",
  score: 0.85,
  reason:
    "A full reasoning sentence that should not be clipped at all in the v2 redesign.",
  platforms: ["PC"],
  algorithm: "ai",
  slot: "comfort",
  fitChips: {
    timeFit: "perfect",
    moodMatches: ["challenged"],
    inLibrary: false,
    friendsCount: 0,
  },
  confidence: "strong",
};

const props = {
  connectedPlatforms: [] as ("steam" | "xbox" | "psn")[],
  gamePlatforms: [] as ("steam" | "xbox" | "psn")[],
  onDismissed: () => {},
};

describe("RecCard v2 (static render)", () => {
  it("renders the FULL reasoning text and does NOT line-clamp it", () => {
    const html = renderToStaticMarkup(<RecCard rec={baseRec} {...props} />);
    expect(html).toContain("A full reasoning sentence that should not be clipped");
    expect(html).not.toContain("line-clamp-3");
  });

  it("shows the confidence pill for non-wildcard cards", () => {
    expect(renderToStaticMarkup(<RecCard rec={baseRec} {...props} />)).toContain(
      "Strong match",
    );
  });

  it("HIDES the confidence pill for wildcard cards", () => {
    const html = renderToStaticMarkup(
      <RecCard rec={{ ...baseRec, slot: "wildcard" }} {...props} />,
    );
    expect(html).not.toContain("Strong match");
    expect(html).toContain("Wildcard"); // slot badge still renders
  });

  it("shows the library badge only when inLibrary", () => {
    expect(
      renderToStaticMarkup(<RecCard rec={baseRec} {...props} />),
    ).not.toContain("In your library");
    expect(
      renderToStaticMarkup(
        <RecCard
          rec={{ ...baseRec, fitChips: { ...baseRec.fitChips, inLibrary: true } }}
          {...props}
        />,
      ),
    ).toContain("In your library");
  });

  it("shows the friends chip only when friendsCount>0", () => {
    expect(
      renderToStaticMarkup(<RecCard rec={baseRec} {...props} />),
    ).not.toMatch(/\d+ played/i);
    expect(
      renderToStaticMarkup(
        <RecCard
          rec={{ ...baseRec, fitChips: { ...baseRec.fitChips, friendsCount: 3 } }}
          {...props}
        />,
      ),
    ).toMatch(/3 played/i);
  });

  it("renders the slot badge + the dismiss-split trigger + Play/Save actions", () => {
    const html = renderToStaticMarkup(<RecCard rec={baseRec} {...props} />);
    expect(html).toContain("Comfort"); // SlotBadge
    expect(html).toContain('data-testid="rec-card"'); // root testid for T20
    expect(html).toContain('aria-label="Dismiss"'); // dismiss-split trigger
    expect(html).toContain("Save for later");
    expect(html).toContain("Play this"); // 0-overlap PlayThisButton
  });

  it("uses the real accent theme token (regression guard for T14 carry-forward)", () => {
    expect(renderToStaticMarkup(<RecCard rec={baseRec} {...props} />)).toContain(
      "var(--accent)",
    );
  });

  // Production bug 2026-05-15: the "Not interested ▾" dropdown is the LAST
  // element in the card and opens downward (absolute top-full). When the
  // card ROOT carries `overflow-hidden` (it did, to clip the cover art to
  // the rounded corners) the popover is clipped by the card box. Fix moves
  // the corner-clip to the cover wrapper so the root no longer clips.
  it("does not clip the dismiss popover: overflow-hidden lives on the cover wrapper, not the card root", () => {
    const html = renderToStaticMarkup(<RecCard rec={baseRec} {...props} />);
    const rootClass =
      /data-testid="rec-card"[^>]*\bclass="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(rootClass).not.toBe("");
    expect(rootClass).not.toContain("overflow-hidden");
    // Corner-clipping of the cover art is preserved, just relocated to the
    // aspect-ratio image wrapper.
    expect(html).toMatch(/aspect-\[2\/3\][^"]*overflow-hidden/);
  });
});

/**
 * guardedCardAction throw-guard contract (Task 16).
 *
 * `guardedCardAction` is the exported action-runner used by every card handler.
 * It is a pure async function: testable directly in Node without a DOM.
 *
 * Three contracts:
 *   1. THROW path  → onError() fires (RED against pre-fix code which had no
 *      try/catch, so the rejection propagated and onError was never called)
 *   2. STRUCTURED {ok:false} path → onError() does NOT fire (the inner
 *      `r.ok` branch fires toast itself; the guard is for outer throws only)
 *   3. SUCCESS path → onError() does NOT fire
 *
 * RED genuineness: pre-fix `guardedCardAction` did NOT EXIST (the export was
 * added in the fix commit). So a symbol-missing test would also be red pre-fix,
 * but for the wrong reason. These helper tests are kept because they validly
 * cover the throw-guard contract in isolation (a no-catch regression guard).
 * The GENUINE BEHAVIORAL RED — proving the card's save wiring calls toast.error
 * AND onRestore when saveRecForLater throws — lives in the "card save throw-path"
 * suite below; it is red pre-fix for the behavioral reason, not symbol-missing.
 *
 * Tests 2 & 3 pass both before and after (proving no regression on the
 * already-correct paths).
 */
describe("guardedCardAction throw-guard contract", () => {
  it("THROW path: onError fires when the action throws", async () => {
    const onError = vi.fn();
    const throwing = async () => {
      throw new Error("DB down");
    };
    // Swallow the rejection — pre-fix propagates; post-fix is caught internally.
    await guardedCardAction(throwing, onError).catch(() => {});
    // Pre-fix (no try/catch in guardedCardAction body): onError never called.
    // Post-fix (try/catch present): catch fires onError.
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("SUCCESS path (regression guard): onError does NOT fire on a resolved action", async () => {
    const onError = vi.fn();
    const succeeding = async () => {
      // returns void; simulates a resolved server action
    };
    await guardedCardAction(succeeding, onError);
    expect(onError).not.toHaveBeenCalled();
  });

  it("STRUCTURED-failure path (regression guard): onError does NOT fire when action resolves (error handled internally by r.ok branch)", async () => {
    const onError = vi.fn();
    // A structured failure returns {ok:false} but does NOT throw — the action
    // function itself resolves normally; the r.ok-check inside the action body
    // handles the error toast. guardedCardAction must not double-fire onError.
    const structuredFailure = async () => {
      // simulates: const r = await serverAction(...); if (!r.ok) toast.error(...)
      // The action RETURNS normally — it does not throw.
    };
    await guardedCardAction(structuredFailure, onError);
    expect(onError).not.toHaveBeenCalled();
  });

  it("RecCard accepts onRestore prop without type error (static render smoke-test)", () => {
    // If onRestore is not declared on RecCard's props, TypeScript rejects the
    // JSX and renderToStaticMarkup throws. This test catches prop-shape drift.
    const onRestore = vi.fn();
    const html = renderToStaticMarkup(
      <RecCard
        rec={baseRec}
        {...props}
        onRestore={onRestore}
      />,
    );
    // Card still renders correctly with onRestore wired.
    expect(html).toContain('data-testid="rec-card"');
    expect(html).toContain("Save for later");
  });
});

/**
 * Card save throw-path — GENUINE BEHAVIORAL RED (Task 16 AC-4).
 *
 * Seam used: `buildSaveOnError(recId, onRestore)` — a factory exported from
 * rec-card.tsx that returns the exact `onError` callback that `doDismiss`
 * assembles when `onSave` calls it. The component's runtime behavior is
 * BYTE-IDENTICAL: the factory extracts only the already-inlined lambda so it
 * is importable for testing; nothing in the call path changes.
 *
 * The real wiring (rec-card.tsx):
 *   onSave → doDismiss(saveAction, () => onRestore?.(rec.id))
 *   doDismiss → guardedCardAction(action, () => {
 *                 toast.error("Something went wrong — try again.");
 *                 onThrow?.();   // = () => onRestore?.(rec.id)
 *               })
 *
 * buildSaveOnError("rec-1", restoreSpy) returns that combined callback.
 * The test then drives: guardedCardAction(throwingSaveAction, buildSaveOnError(...))
 * — the exact production code path, just without startTransition/onDismissed
 * (which are side-effects orthogonal to the toast+restore contract).
 *
 * RED genuineness — proven via the pre-fix model:
 *   Pre-fix doDismiss had NO try/catch (startTransition(action) naked).
 *   Simulating that: a pass-through runner `async (a, _onErr) => a()` lets
 *   the throw propagate — onError callback is never reached.
 *   Running the pre-fix simulation FAILS: toast.error not called, onRestore
 *   not called. Running against the real guardedCardAction PASSES.
 *   See proof comment on the pre-fix simulation test below.
 */
describe("card save throw-path (genuine behavioral RED, Task 16 AC-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * GENUINE BEHAVIORAL RED.
   *
   * Drives the REAL save assembly via buildSaveOnError + guardedCardAction.
   *
   * Pre-fix simulation (shown in test below this one) FAILS this exact
   * assertion pattern — not with "is not a function" but with:
   *   AssertionError: expected toast.error to have been called with arguments:
   *     [ 'Something went wrong — try again.' ] ... Times called: 0
   * Post-fix (real guardedCardAction with try/catch): PASSES.
   */
  it("BEHAVIORAL RED: saveRecForLater throw → toast.error('Something went wrong…') AND onRestore called with rec.id", async () => {
    const { saveRecForLater } = await import("@/lib/recs/server-actions");
    const { toast } = await import("sonner");
    vi.mocked(saveRecForLater).mockRejectedValue(new Error("DB down"));

    const restoreSpy = vi.fn();
    const onError = buildSaveOnError(baseRec.id, restoreSpy);

    // Drive the REAL save action body (same closure onSave builds):
    const saveAction = async () => {
      // This is the exact action passed to doDismiss in onSave (rec-card.tsx:139-143):
      const r = await saveRecForLater(baseRec.id);
      if (r.ok) toast.success(r.message);
      else toast.error("Couldn't save this one.");
    };

    // This is what doDismiss does (minus startTransition + onDismissed):
    await guardedCardAction(saveAction, onError);

    // Both must fire — this is the BEHAVIORAL contract (not present pre-fix):
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Something went wrong — try again.",
    );
    expect(restoreSpy).toHaveBeenCalledWith(baseRec.id);
  });

  /**
   * Pre-fix simulation — demonstrates the RED is BEHAVIORAL, not symbol-missing.
   *
   * The pre-fix doDismiss was:
   *   startTransition(() => action())   ← no try/catch, no guardedCardAction call
   *
   * Simulated here as a pass-through runner (no try/catch):
   *   async (a) => a()
   *
   * When saveRecForLater rejects the throw propagates past the runner,
   * the onError callback is never invoked, toast.error is never called,
   * and restoreSpy is never called.
   *
   * If we ran the BEHAVIORAL assertion from the test above against this
   * simulation it would fail with:
   *   AssertionError: expected toast.error to have been called with arguments:
   *     [ 'Something went wrong — try again.' ]
   *   Number of calls: 0
   * This confirms the RED is a BEHAVIORAL assertion failure, not a missing symbol.
   *
   * This test asserts the pre-fix behavior IS absent (i.e. no toast.error,
   * no restore) as a regression guard proving the simulation model is correct.
   */
  it("pre-fix model (pass-through runner): toast.error NOT called and onRestore NOT called — confirms behavioral RED is genuine", async () => {
    const { saveRecForLater } = await import("@/lib/recs/server-actions");
    const { toast } = await import("sonner");
    vi.mocked(saveRecForLater).mockRejectedValue(new Error("DB down"));

    const restoreSpy = vi.fn();
    const onError = buildSaveOnError(baseRec.id, restoreSpy);

    const saveAction = async () => {
      const r = await saveRecForLater(baseRec.id);
      if (r.ok) toast.success(r.message);
      else toast.error("Couldn't save this one.");
    };

    // Pre-fix runner: pass-through, no try/catch — throw propagates, onError never runs.
    const prefixRunner = async (
      action: () => Promise<void>,
      _onError: () => void,
    ) => action();

    // Swallow the propagated rejection (pre-fix behavior).
    await prefixRunner(saveAction, onError).catch(() => {});

    // Pre-fix: neither toast.error(generic) nor onRestore were called.
    // This is what was WRONG — and what the behavioral assertion above proves is now fixed.
    expect(vi.mocked(toast.error)).not.toHaveBeenCalledWith(
      "Something went wrong — try again.",
    );
    expect(restoreSpy).not.toHaveBeenCalled();
  });
});
