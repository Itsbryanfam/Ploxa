import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FilterChipPopover } from "@/components/recs/filter-chip-popover";

/**
 * filter-chip-popover.test.tsx — play-next redesign T16.
 *
 * The repo's vitest setup runs in a Node environment with no DOM and no
 * `@testing-library/react` dep (see vitest.config.ts + the header on
 * tests/unit/recs/rec-card-v2.test.tsx). Component tests therefore use
 * `react-dom/server.renderToStaticMarkup` and assert on the HTML string.
 *
 * FilterChipPopover is a `"use client"` component, but unlike RecCard it has
 * NO import-time hazards: it only uses `useState`, `cn` (clsx + tailwind-merge,
 * both pure), and `import type { Mood, TimeBudget }` (type-only, erased at
 * runtime). There is no `useRouter`, no server-actions transitive graph, no
 * framer-motion and no sonner — so NO `vi.mock` is required (contrast the
 * justified mock set in rec-card-v2.test.tsx).
 *
 * The popover is closed by default (`open === false`), so the per-variant
 * option buttons are NOT in the static markup. These tests therefore assert
 * the statically-renderable surface: the chip LABEL derivation (the
 * substantive pure logic — variant dispatch, multi-join, empty placeholder)
 * and the trigger testid. Interaction (open / select / onChange / auto-close
 * for time / no-close + 2-mood-cap for mood / platform toggle) is
 * INTENTIONALLY deferred to T20 Playwright — there is no DOM here and the repo
 * has no RTL dep. No assertions are weakened.
 */

describe("FilterChipPopover — chip label derivation (static)", () => {
  it("time variant shows the mapped label for the current value", () => {
    const html = renderToStaticMarkup(
      <FilterChipPopover variant="time" value="1hr" onChange={() => {}} />,
    );
    expect(html).toContain("1 hour");
    expect(html).toContain('data-testid="filter-chip-time"');
  });

  it("time variant maps every known TimeBudget value to its label", () => {
    expect(
      renderToStaticMarkup(
        <FilterChipPopover variant="time" value="15min" onChange={() => {}} />,
      ),
    ).toContain("15 min");
    expect(
      renderToStaticMarkup(
        <FilterChipPopover
          variant="time"
          value="3hr+"
          onChange={() => {}}
        />,
      ),
    ).toContain("3+ hours");
    expect(
      renderToStaticMarkup(
        <FilterChipPopover
          variant="time"
          value="multi-session"
          onChange={() => {}}
        />,
      ),
    ).toContain("Multi-session");
  });

  it("mood variant joins multi-select labels with ' + '", () => {
    expect(
      renderToStaticMarkup(
        <FilterChipPopover
          variant="mood"
          value={["chill"]}
          onChange={() => {}}
        />,
      ),
    ).toContain("Chill");
    expect(
      renderToStaticMarkup(
        <FilterChipPopover
          variant="mood"
          value={["chill", "challenged"]}
          onChange={() => {}}
        />,
      ),
    ).toContain("Chill + Challenged");
  });

  it("mood variant shows the 'Mood' placeholder when empty", () => {
    expect(
      renderToStaticMarkup(
        <FilterChipPopover variant="mood" value={[]} onChange={() => {}} />,
      ),
    ).toContain("Mood");
  });

  it("mood variant maps story-driven / mindless / multiplayer labels", () => {
    expect(
      renderToStaticMarkup(
        <FilterChipPopover
          variant="mood"
          value={["story-driven", "mindless"]}
          onChange={() => {}}
        />,
      ),
    ).toContain("Story-driven + Mindless");
    expect(
      renderToStaticMarkup(
        <FilterChipPopover
          variant="mood"
          value={["multiplayer"]}
          onChange={() => {}}
        />,
      ),
    ).toContain("Multiplayer");
  });

  it("platform variant labels selected platforms and joins with ', '", () => {
    const html = renderToStaticMarkup(
      <FilterChipPopover
        variant="platform"
        value={["steam", "psn"]}
        options={["steam", "xbox", "psn"]}
        onChange={() => {}}
      />,
    );
    expect(html).toContain("Steam, PlayStation");
    expect(html).toContain('data-testid="filter-chip-platform"');
  });

  it("platform variant shows the 'Platform' placeholder when empty", () => {
    expect(
      renderToStaticMarkup(
        <FilterChipPopover
          variant="platform"
          value={[]}
          options={["steam"]}
          onChange={() => {}}
        />,
      ),
    ).toContain("Platform");
  });

  it("renders the text caret affordance (icon-free recs-family convention)", () => {
    expect(
      renderToStaticMarkup(
        <FilterChipPopover variant="time" value="1hr" onChange={() => {}} />,
      ),
    ).toContain("▾");
  });
});
