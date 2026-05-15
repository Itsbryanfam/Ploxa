import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
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

import { RecCard } from "@/components/recs/rec-card";
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
