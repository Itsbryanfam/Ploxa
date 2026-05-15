/**
 * recap-email.test.ts — Phase 6 T17.
 *
 * Unit tests for `lib/email/recap-template.tsx`.
 *
 * Strategy: render to HTML/plain-text string and assert on substrings.
 * We do NOT test React internal rendering mechanics — only the final output.
 *
 * Vitest environment: node (see vitest.config.ts).
 * No mocks required — the template is a pure function of its props.
 */

import { describe, expect, it } from "vitest";

import {
  recapSubject,
  renderRecapHtml,
  renderRecapPlainText,
} from "@/lib/email/recap-template";
import type { RecapEmailProps } from "@/lib/email/recap-template";
import type { RecapPayload } from "@/lib/recaps/types";

// ─────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────

const samplePayload: RecapPayload = {
  tier: "ok",
  mode: "yearly",
  windowStart: "2026-01-01T00:00:00.000Z",
  windowEnd: "2027-01-01T00:00:00.000Z",
  scenes: ["opening", "stats_total", "goty", "closing"],
  totals: {
    totalGames: 47,
    totalHoursPlayed: 120,
    completedCount: 30,
    droppedCount: 5,
    replayingCount: 2,
    reviewCount: 4,
  },
  topGames: [
    {
      gameId: "g1",
      rawgId: 12345,
      title: "Hades II",
      coverUrl: "https://example.com/hades.jpg",
      rating: 5,
      status: "completed",
    },
  ],
  goty: {
    gameId: "g1",
    rawgId: 12345,
    title: "Hades II",
    coverUrl: "https://example.com/hades.jpg",
    rating: 5,
    status: "completed",
  },
  topGenre: { name: "Action", pct: 40, secondName: "RPG", secondPct: 20 },
  captions: {},
};

const yearlyProps: RecapEmailProps = {
  payload: samplePayload,
  mode: "yearly",
  recapUrl: "https://ploxa.vercel.app/u/alex/year/2026",
  unsubscribeUrl: "https://ploxa.vercel.app/unsubscribe?token=abc123",
};

const monthlyPayload: RecapPayload = {
  ...samplePayload,
  mode: "monthly",
  windowStart: "2026-05-01T00:00:00.000Z",
  windowEnd: "2026-06-01T00:00:00.000Z",
};

const monthlyProps: RecapEmailProps = {
  payload: monthlyPayload,
  mode: "monthly",
  recapUrl: "https://ploxa.vercel.app/u/alex/month/202605",
  unsubscribeUrl: "https://ploxa.vercel.app/unsubscribe?token=xyz456",
};

const sparsePayload: RecapPayload = {
  ...samplePayload,
  tier: "too_sparse",
  totals: {
    totalGames: 2,
    totalHoursPlayed: null,
    completedCount: 1,
    droppedCount: 1,
    replayingCount: 0,
    reviewCount: 0,
  },
  topGames: [],
  goty: undefined,
  topGenre: undefined,
};

const sparseProps: RecapEmailProps = {
  payload: sparsePayload,
  mode: "yearly",
  recapUrl: "https://ploxa.vercel.app/u/alex/year/2026",
  unsubscribeUrl: "https://ploxa.vercel.app/unsubscribe?token=sparse789",
};

// ─────────────────────────────────────────────────────────────
// recapSubject
// ─────────────────────────────────────────────────────────────

describe("recapSubject", () => {
  it("yearly subject returns 'Your <year> in games'", () => {
    expect(recapSubject({ mode: "yearly", year: 2026 })).toBe("Your 2026 in games");
  });

  it("monthly subject returns 'Your <month> <year> recap'", () => {
    expect(recapSubject({ mode: "monthly", year: 2026, monthIndex: 5 })).toBe(
      "Your May 2026 recap",
    );
  });

  it("monthly subject uses correct month name for month 1 (January)", () => {
    expect(recapSubject({ mode: "monthly", year: 2026, monthIndex: 1 })).toBe(
      "Your January 2026 recap",
    );
  });

  it("monthly subject uses correct month name for month 12 (December)", () => {
    expect(recapSubject({ mode: "monthly", year: 2026, monthIndex: 12 })).toBe(
      "Your December 2026 recap",
    );
  });

  it("monthly throws when monthIndex is missing", () => {
    expect(() =>
      recapSubject({ mode: "monthly", year: 2026 } as Parameters<typeof recapSubject>[0]),
    ).toThrow();
  });

  it("monthly throws when monthIndex is out of range (0)", () => {
    expect(() => recapSubject({ mode: "monthly", year: 2026, monthIndex: 0 })).toThrow();
  });

  it("monthly throws when monthIndex is out of range (13)", () => {
    expect(() => recapSubject({ mode: "monthly", year: 2026, monthIndex: 13 })).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// renderRecapHtml — yearly
// ─────────────────────────────────────────────────────────────

describe("renderRecapHtml — yearly", () => {
  it("contains the year in the hero heading", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).toContain("2026");
  });

  it("contains the recap URL in a link", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).toContain("https://ploxa.vercel.app/u/alex/year/2026");
  });

  it("contains the unsubscribe URL in the footer", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).toContain("https://ploxa.vercel.app/unsubscribe?token=abc123");
  });

  it("contains the game count in the stat strip", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).toContain("47");
  });

  it("contains the top genre in the stat strip", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).toContain("Action");
  });

  it("renders the cover img tag when goty.coverUrl is present", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).toContain("https://example.com/hades.jpg");
  });

  it("renders the goty title when present", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).toContain("Hades II");
  });

  it("omits cover img when goty is null", async () => {
    const noGotyPayload: RecapPayload = { ...samplePayload, goty: undefined };
    const html = await renderRecapHtml({ ...yearlyProps, payload: noGotyPayload });
    expect(html).not.toContain("https://example.com/hades.jpg");
  });

  it("uses 'varied' when topGenre is null", async () => {
    const noGenrePayload: RecapPayload = { ...samplePayload, topGenre: undefined };
    const html = await renderRecapHtml({ ...yearlyProps, payload: noGenrePayload });
    expect(html).toContain("varied");
  });

  it("contains the Ploxa wordmark in the footer", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).toContain("Ploxa");
  });

  it("no exclamation marks (calm-copy rule)", async () => {
    const html = await renderRecapHtml(yearlyProps);
    // Strip HTML tags and DOCTYPE declarations before checking for exclamation marks.
    // `<!` is a valid HTML construct (DOCTYPE, comments) — we care about content only.
    const content = html.replace(/<[^>]+>/g, " ").replace(/<!--[\s\S]*?-->/g, "");
    expect(content).not.toMatch(/!/);
  });

  it("no emoji codepoints", async () => {
    const html = await renderRecapHtml(yearlyProps);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(html).not.toMatch(/[\u{1F600}-\u{1F64F}]/u);
    expect(html).not.toMatch(/[\u{2600}-\u{27BF}]/u);
  });
});

// ─────────────────────────────────────────────────────────────
// renderRecapHtml — monthly
// ─────────────────────────────────────────────────────────────

describe("renderRecapHtml — monthly", () => {
  it("contains the month name in the hero heading", async () => {
    const html = await renderRecapHtml(monthlyProps);
    expect(html).toContain("May");
  });

  it("contains the year alongside the month name", async () => {
    const html = await renderRecapHtml(monthlyProps);
    expect(html).toContain("2026");
  });

  it("contains the monthly recap URL", async () => {
    const html = await renderRecapHtml(monthlyProps);
    expect(html).toContain("https://ploxa.vercel.app/u/alex/month/202605");
  });

  it("contains the unsubscribe URL", async () => {
    const html = await renderRecapHtml(monthlyProps);
    expect(html).toContain("https://ploxa.vercel.app/unsubscribe?token=xyz456");
  });

  it("no exclamation marks", async () => {
    const html = await renderRecapHtml(monthlyProps);
    const content = html.replace(/<[^>]+>/g, " ").replace(/<!--[\s\S]*?-->/g, "");
    expect(content).not.toMatch(/!/);
  });

  it("no emoji codepoints", async () => {
    const html = await renderRecapHtml(monthlyProps);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

// ─────────────────────────────────────────────────────────────
// renderRecapHtml — sparse tier
// ─────────────────────────────────────────────────────────────

describe("renderRecapHtml — sparse tier", () => {
  it("emits the keep-it-up calm message", async () => {
    const html = await renderRecapHtml(sparseProps);
    expect(html).toContain("keep it up");
  });

  it("does not include the recap CTA URL body section", async () => {
    const html = await renderRecapHtml(sparseProps);
    // The recap URL must still appear (it's passed to the component)
    // but no game count or genre strip should be present for sparse payloads
    expect(html).not.toContain("games logged");
  });

  it("still includes the unsubscribe link in footer", async () => {
    const html = await renderRecapHtml(sparseProps);
    expect(html).toContain("https://ploxa.vercel.app/unsubscribe?token=sparse789");
  });

  it("no exclamation marks on sparse variant", async () => {
    const html = await renderRecapHtml(sparseProps);
    const content = html.replace(/<[^>]+>/g, " ").replace(/<!--[\s\S]*?-->/g, "");
    expect(content).not.toMatch(/!/);
  });

  it("no emoji codepoints on sparse variant", async () => {
    const html = await renderRecapHtml(sparseProps);
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

// ─────────────────────────────────────────────────────────────
// renderRecapPlainText — yearly
// ─────────────────────────────────────────────────────────────

describe("renderRecapPlainText — yearly", () => {
  it("contains the stats line with game count and genre", () => {
    const text = renderRecapPlainText(yearlyProps);
    expect(text).toContain("47 games logged");
    expect(text).toContain("Top genre: Action");
  });

  it("contains the CTA URL", () => {
    const text = renderRecapPlainText(yearlyProps);
    expect(text).toContain("https://ploxa.vercel.app/u/alex/year/2026");
  });

  it("contains the unsubscribe URL", () => {
    const text = renderRecapPlainText(yearlyProps);
    expect(text).toContain("https://ploxa.vercel.app/unsubscribe?token=abc123");
  });

  it("mentions the year in the header line", () => {
    const text = renderRecapPlainText(yearlyProps);
    expect(text).toContain("2026");
  });

  it("mentions the top game title when present", () => {
    const text = renderRecapPlainText(yearlyProps);
    expect(text).toContain("Hades II");
  });

  it("no exclamation marks", () => {
    const text = renderRecapPlainText(yearlyProps);
    expect(text).not.toMatch(/!/);
  });

  it("no HTML entities in plain text (e.g. &amp; or &middot;)", () => {
    const text = renderRecapPlainText(yearlyProps);
    expect(text).not.toMatch(/&\w+;/);
  });
});

// ─────────────────────────────────────────────────────────────
// renderRecapPlainText — monthly
// ─────────────────────────────────────────────────────────────

describe("renderRecapPlainText — monthly", () => {
  it("contains the month name", () => {
    const text = renderRecapPlainText(monthlyProps);
    expect(text).toContain("May");
  });

  it("contains the year", () => {
    const text = renderRecapPlainText(monthlyProps);
    expect(text).toContain("2026");
  });

  it("contains the monthly CTA URL", () => {
    const text = renderRecapPlainText(monthlyProps);
    expect(text).toContain("https://ploxa.vercel.app/u/alex/month/202605");
  });

  it("contains the unsubscribe URL", () => {
    const text = renderRecapPlainText(monthlyProps);
    expect(text).toContain("https://ploxa.vercel.app/unsubscribe?token=xyz456");
  });

  it("no exclamation marks", () => {
    const text = renderRecapPlainText(monthlyProps);
    expect(text).not.toMatch(/!/);
  });
});

// ─────────────────────────────────────────────────────────────
// renderRecapPlainText — sparse tier
// ─────────────────────────────────────────────────────────────

describe("renderRecapPlainText — sparse tier", () => {
  it("emits keep-it-up message", () => {
    const text = renderRecapPlainText(sparseProps);
    expect(text).toContain("keep it up");
  });

  it("still contains the unsubscribe URL", () => {
    const text = renderRecapPlainText(sparseProps);
    expect(text).toContain("https://ploxa.vercel.app/unsubscribe?token=sparse789");
  });

  it("no exclamation marks on sparse plain text", () => {
    const text = renderRecapPlainText(sparseProps);
    expect(text).not.toMatch(/!/);
  });
});
