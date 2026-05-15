import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  RefinementInput,
  applyRefinement,
  QUICK_CHIPS,
  MAX_ACTIVE,
  CHAR_CAP,
} from "@/components/recs/refinement-input";

/**
 * refinement-input.test.tsx — play-next redesign T17.
 *
 * The repo's vitest setup runs in a Node environment with no DOM and no
 * `@testing-library/react` dep (see vitest.config.ts + the header on
 * tests/unit/recs/rec-card-v2.test.tsx). Component tests therefore use
 * `react-dom/server.renderToStaticMarkup` and assert on the HTML string.
 *
 * RefinementInput is a `"use client"` component that composes the shared
 * `MascotPrompt` → `Mascot`. Unlike RecCard it has NO import-time hazards
 * that require mocking: it only uses `useState`, `cn` (pure), and renders
 * `Mascot`, whose `useMascotStore` (Zustand `useSyncExternalStore`) and
 * `next/image` both SSR cleanly under `renderToStaticMarkup` in the Node
 * env (verified: a no-mock probe render succeeds). So — like
 * filter-chip-popover.test.tsx and in contrast to the justified mock set
 * in rec-card-v2.test.tsx — NO `vi.mock` is required here.
 *
 * Two parts:
 *   (A) Direct unit tests of the pure exported `applyRefinement` — the
 *       bug-prone clamp/dedupe/cap/no-op core. No DOM needed; this is the
 *       substantive logic and is fully covered here.
 *   (B) `renderToStaticMarkup` static-render assertions of the rendered
 *       surface (prompt copy, placeholder, all quick chips, active pills,
 *       conditional "Clear all", real accent token, no name leak).
 *
 * Interaction (typing, Enter-to-commit, chip click, pill remove, clear-all
 * DOM events) is INTENTIONALLY deferred to T20 Playwright — there is no DOM
 * here and the repo has no RTL dep. The data-testids asserted below exist
 * for that suite. No assertions are weakened.
 */

describe("applyRefinement (pure core)", () => {
  it("appends a cleaned entry", () => {
    expect(applyRefinement([], "weirder games")).toEqual(["weirder games"]);
  });

  it("trims + collapses newlines + clamps to CHAR_CAP", () => {
    const out = applyRefinement([], "  a\nb  " + "x".repeat(300));
    expect(out[0].length).toBe(CHAR_CAP);
    expect(out[0]).not.toContain("\n");
  });

  it("no-ops (same ref) on empty/whitespace", () => {
    const a = ["x"];
    expect(applyRefinement(a, "   ")).toBe(a);
    expect(applyRefinement(a, "\n")).toBe(a);
  });

  it("no-ops (same ref) on duplicate", () => {
    const a = ["less grindy"];
    expect(applyRefinement(a, "less grindy")).toBe(a);
  });

  it("drops the OLDEST when exceeding MAX_ACTIVE", () => {
    const out = applyRefinement(["a", "b", "c", "d", "e"], "f");
    expect(out).toEqual(["b", "c", "d", "e", "f"]);
    expect(out.length).toBe(MAX_ACTIVE);
  });
});

describe("RefinementInput (static render)", () => {
  it("renders the prompt copy, input placeholder, and all quick chips — no 'Cortez'", () => {
    const html = renderToStaticMarkup(
      <RefinementInput active={[]} onChange={() => {}} />,
    );
    expect(html).toContain("Tell us what to try");
    expect(html).not.toContain("Cortez");
    expect(html).toContain("less grindy"); // placeholder + first chip
    expect(html).toContain("more story");
    for (const c of QUICK_CHIPS) expect(html).toContain(c);
    expect(html).toContain('data-testid="refinement-input"');
    expect(html).toContain('data-testid="refinement-submit"');
  });

  it("renders active refinements as pills with Remove aria-labels + testids", () => {
    const html = renderToStaticMarkup(
      <RefinementInput active={["less grindy", "shorter"]} onChange={() => {}} />,
    );
    expect(html).toContain("less grindy");
    expect(html).toContain("shorter");
    // renderToStaticMarkup HTML-escapes the quotes in the aria-label.
    expect(html).toContain('aria-label="Remove &quot;less grindy&quot;"');
    // testid is unambiguous regardless of escaping — primary T20 hook.
    expect(html).toContain('data-testid="refinement-remove-less grindy"');
  });

  it("shows 'Clear all' only when >=2 active", () => {
    expect(
      renderToStaticMarkup(
        <RefinementInput active={["a"]} onChange={() => {}} />,
      ),
    ).not.toContain("Clear all");
    expect(
      renderToStaticMarkup(
        <RefinementInput active={["a", "b"]} onChange={() => {}} />,
      ),
    ).toContain("Clear all");
  });

  it("uses the real accent token (no fictional brand-purple)", () => {
    expect(
      renderToStaticMarkup(
        <RefinementInput active={["x"]} onChange={() => {}} />,
      ),
    ).toContain("var(--accent)");
    expect(
      renderToStaticMarkup(
        <RefinementInput active={[]} onChange={() => {}} />,
      ),
    ).not.toContain("brand-purple");
  });
});
