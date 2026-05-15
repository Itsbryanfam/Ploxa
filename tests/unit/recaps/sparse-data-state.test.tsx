import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { SparseDataState } from "@/components/recaps/SparseDataState";

/**
 * sparse-data-state.test.tsx — Phase 6 T10.
 *
 * Uses the same `react-dom/server.renderToStaticMarkup` pattern as
 * `featured-list-card.test.tsx` — the repo's vitest setup runs in a Node
 * environment with no DOM and no `@testing-library/react` dep. The
 * component is a pure server-render presentational tree (no state, no
 * effects), so static markup is faithful to what the browser will see.
 *
 * The Mascot client component is rendered via `next/image`; in Node it
 * still produces an `<img>` tag in the static markup, which is sufficient
 * for the assertions here. We do not assert on the sprite itself — that's
 * exercised by other surfaces already.
 */

describe("SparseDataState — content", () => {
  it("renders the heading and body copy", () => {
    const html = renderToStaticMarkup(<SparseDataState username="alice" />);
    expect(html).toContain("Not enough yet");
    expect(html).toContain("Come back");
  });

  it("renders a heading element around the title", () => {
    const html = renderToStaticMarkup(<SparseDataState username="alice" />);
    expect(html).toMatch(/<h2[^>]*>[^<]*Not enough yet[^<]*<\/h2>/);
  });

  it("emits no exclamation marks (calm copy)", () => {
    const html = renderToStaticMarkup(<SparseDataState username="alice" />);
    expect(html).not.toMatch(/!/);
  });

  it("emits no emoji codepoints", () => {
    const html = renderToStaticMarkup(<SparseDataState username="alice" />);
    // Symbols + Pictographs / Supplemental Symbols / Emoticons blocks.
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(html).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
    expect(html).not.toMatch(/[\u{2600}-\u{27BF}]/u);
  });
});

describe("SparseDataState — CTA", () => {
  it("links the CTA to /u/{username}", () => {
    const html = renderToStaticMarkup(<SparseDataState username="alice" />);
    expect(html).toContain('href="/u/alice"');
  });

  it("honors a different username in the CTA href", () => {
    const html = renderToStaticMarkup(<SparseDataState username="bob_42" />);
    expect(html).toContain('href="/u/bob_42"');
  });

  it("renders the CTA as an anchor (Link), not a button", () => {
    const html = renderToStaticMarkup(<SparseDataState username="alice" />);
    // next/link renders as <a href=…>. Defensive against a future swap to <button>.
    expect(html).toMatch(/<a\b[^>]*href="\/u\/alice"/);
    expect(html).not.toMatch(/<button[^>]*>[^<]*Back to profile[^<]*<\/button>/);
  });
});

describe("SparseDataState — accessibility", () => {
  it("uses semantic h2 for the headline", () => {
    const html = renderToStaticMarkup(<SparseDataState username="alice" />);
    expect(html).toMatch(/<h2\b/);
  });
});
