import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FeaturedListCard } from "@/components/recaps/FeaturedListCard";
import type { FeaturedListSummary } from "@/lib/recaps/featured-read";

/**
 * featured-list-card.test.tsx — Phase 6 T9.
 *
 * The repo's vitest setup runs in a Node environment with no DOM and no
 * `@testing-library/react` dep. Component tests therefore use
 * `react-dom/server.renderToStaticMarkup` to produce an HTML string and
 * assert against substrings / regexes. This matches the lightweight,
 * dep-free style already used in `tests/unit/recaps/*`.
 *
 * The card is a pure server-render presentational component (no state,
 * no client islands), so static-markup output is faithful to what the
 * browser will see.
 */

const samplePin: FeaturedListSummary = {
  listId: "list-1",
  listTitle: "Best of 2026",
  listSlug: "best-of-2026",
  authorUsername: "alice",
  itemCount: 12,
  coverUrls: [
    "https://example.com/a.jpg",
    "https://example.com/b.jpg",
    "https://example.com/c.jpg",
    "https://example.com/d.jpg",
  ],
};

describe("FeaturedListCard — content", () => {
  it("renders the list title", () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    expect(html).toContain("Best of 2026");
  });

  it('renders the "Picked by us" eyebrow label', () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    expect(html).toContain("Picked by us");
  });

  it("uses semantic <article> wrapper", () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    expect(html).toMatch(/<article\b/);
  });

  it("renders the title inside a heading element", () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    // Title appears inside an <h3> per plan markup.
    expect(html).toMatch(/<h3[^>]*>[^<]*Best of 2026[^<]*<\/h3>/);
  });

  it("emits no exclamation marks (calm copy)", () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    expect(html).not.toContain("!");
  });
});

describe("FeaturedListCard — pluralization", () => {
  it("uses plural 'games' for itemCount > 1", () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    expect(html).toContain("12 games");
  });

  it("uses singular 'game' for itemCount === 1", () => {
    const html = renderToStaticMarkup(
      <FeaturedListCard pin={{ ...samplePin, itemCount: 1 }} />,
    );
    // The substring "1 game" appears, but we must verify it's not "1 games".
    expect(html).toContain("1 game");
    expect(html).not.toMatch(/\b1 games\b/);
  });

  it("uses plural 'games' for itemCount === 0 (edge case)", () => {
    const html = renderToStaticMarkup(
      <FeaturedListCard pin={{ ...samplePin, itemCount: 0 }} />,
    );
    expect(html).toContain("0 games");
  });
});

describe("FeaturedListCard — link", () => {
  it("links to canonical /u/{authorUsername}/lists/{listSlug}", () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    expect(html).toContain('href="/u/alice/lists/best-of-2026"');
  });

  it("honors a different author + slug", () => {
    const html = renderToStaticMarkup(
      <FeaturedListCard
        pin={{
          ...samplePin,
          authorUsername: "bob_42",
          listSlug: "rpgs-of-the-decade",
        }}
      />,
    );
    expect(html).toContain('href="/u/bob_42/lists/rpgs-of-the-decade"');
  });
});

describe("FeaturedListCard — cover composite", () => {
  it("renders up to 4 cover <img> elements when 4 are provided", () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    const imgMatches = html.match(/<img\b/g) ?? [];
    expect(imgMatches.length).toBe(4);
  });

  it("renders fewer than 4 imgs when coverUrls.length < 4", () => {
    const html = renderToStaticMarkup(
      <FeaturedListCard
        pin={{
          ...samplePin,
          coverUrls: [
            "https://example.com/a.jpg",
            "https://example.com/b.jpg",
          ],
        }}
      />,
    );
    const imgMatches = html.match(/<img\b/g) ?? [];
    expect(imgMatches.length).toBe(2);
  });

  it("renders zero <img> elements when coverUrls is empty", () => {
    const html = renderToStaticMarkup(
      <FeaturedListCard pin={{ ...samplePin, coverUrls: [] }} />,
    );
    const imgMatches = html.match(/<img\b/g) ?? [];
    expect(imgMatches.length).toBe(0);
  });

  it("caps at 4 imgs even when coverUrls has more", () => {
    const html = renderToStaticMarkup(
      <FeaturedListCard
        pin={{
          ...samplePin,
          coverUrls: [
            "https://example.com/a.jpg",
            "https://example.com/b.jpg",
            "https://example.com/c.jpg",
            "https://example.com/d.jpg",
            "https://example.com/e.jpg",
            "https://example.com/f.jpg",
          ],
        }}
      />,
    );
    const imgMatches = html.match(/<img\b/g) ?? [];
    expect(imgMatches.length).toBe(4);
  });

  it("uses each cover URL as a src", () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    expect(html).toContain('src="https://example.com/a.jpg"');
    expect(html).toContain('src="https://example.com/b.jpg"');
    expect(html).toContain('src="https://example.com/c.jpg"');
    expect(html).toContain('src="https://example.com/d.jpg"');
  });

  it('uses empty alt="" on decorative cover images', () => {
    const html = renderToStaticMarkup(<FeaturedListCard pin={samplePin} />);
    // Every <img> tag should have alt="".
    const imgTags = html.match(/<img\b[^>]*>/g) ?? [];
    expect(imgTags.length).toBeGreaterThan(0);
    for (const tag of imgTags) {
      expect(tag).toMatch(/\balt=""/);
    }
  });
});
