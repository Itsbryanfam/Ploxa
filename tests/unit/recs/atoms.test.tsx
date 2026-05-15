import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ConfidencePill } from "@/components/recs/atoms/confidence-pill";
import { SlotBadge } from "@/components/recs/atoms/slot-badge";
import { LibraryBadge } from "@/components/recs/atoms/library-badge";

/**
 * atoms.test.tsx — play-next redesign T14.
 *
 * The repo's vitest setup runs in a Node environment with no DOM and no
 * `@testing-library/react` dep. Component tests therefore use
 * `react-dom/server.renderToStaticMarkup` to produce an HTML string and
 * assert against substrings. This mirrors the dep-free style already used
 * across `tests/unit/recaps/*` (see featured-list-card.test.tsx header).
 *
 * ConfidencePill / SlotBadge / LibraryBadge are pure presentational
 * components (no state, no client islands), so static-markup output is
 * faithful to what the browser renders. The `Confidence` / `Slot` prop
 * unions match T12's `RecCard.confidence` / `RecCard.slot` exactly so T15
 * can pass those fields straight through.
 */

describe("ConfidencePill", () => {
  it("renders 'Strong match' for strong confidence", () => {
    const html = renderToStaticMarkup(<ConfidencePill confidence="strong" />);
    expect(html).toContain("Strong match");
  });
  it("renders 'Good match' for good confidence", () => {
    const html = renderToStaticMarkup(<ConfidencePill confidence="good" />);
    expect(html).toContain("Good match");
  });
  it("renders 'Worth a try' for worth-a-try confidence", () => {
    const html = renderToStaticMarkup(<ConfidencePill confidence="worth-a-try" />);
    expect(html).toContain("Worth a try");
  });
  it("strong is visually distinct from worth-a-try (different class output)", () => {
    const strong = renderToStaticMarkup(<ConfidencePill confidence="strong" />);
    const weak = renderToStaticMarkup(<ConfidencePill confidence="worth-a-try" />);
    expect(strong).not.toBe(weak);
  });
});

describe("SlotBadge", () => {
  it("renders 'Comfort' for comfort slot", () => {
    expect(renderToStaticMarkup(<SlotBadge slot="comfort" />)).toContain("Comfort");
  });
  it("renders 'Backlog' for backlog slot", () => {
    expect(renderToStaticMarkup(<SlotBadge slot="backlog" />)).toContain("Backlog");
  });
  it("renders 'Friend pick' for friends slot", () => {
    expect(renderToStaticMarkup(<SlotBadge slot="friends" />)).toContain("Friend pick");
  });
  it("renders 'Wildcard' for wildcard slot", () => {
    expect(renderToStaticMarkup(<SlotBadge slot="wildcard" />)).toContain("Wildcard");
  });
  it("wildcard markup is visually distinct from comfort", () => {
    const wild = renderToStaticMarkup(<SlotBadge slot="wildcard" />);
    const comfort = renderToStaticMarkup(<SlotBadge slot="comfort" />);
    expect(wild).not.toBe(comfort);
  });
});

describe("LibraryBadge", () => {
  it("renders 'In your library'", () => {
    expect(renderToStaticMarkup(<LibraryBadge />)).toContain("In your library");
  });
});
