/**
 * card.tsx — Phase 6 T15.
 *
 * Shared Satori-compatible JSX builder for all four recap OG routes:
 *   /og/year/[username]/[year]
 *   /og/year/[username]/[year]/scene/[i]
 *   /og/month/[username]/[yyyymm]
 *   /og/month/[username]/[yyyymm]/scene/[i]
 *
 * SATORI CONSTRAINTS (enforced throughout this file):
 *   - Inline `style={{...}}` only — no className, no Tailwind, no CSS modules.
 *   - Raw `<img>` not next/image — Satori does not run Next components.
 *   - Every container with children must have `display: "flex"`.
 *   - SVG support is finicky — avoid complex paths; use flat elements instead.
 *   - No external font fetches at request time; use `fontFamily: "system-ui"`.
 *
 * PROJECT MEMORY RULES (reflected throughout):
 *   - No emoji in any rendered text.
 *   - Calm copy: no exclamation marks.
 *   - Dark gradient palette: #0a0a0f / #1a1525 / #e4e4f0 / #7c5cff.
 */

import type { ReactNode } from "react";
import type { RecapPayload, SceneId, TopGameRef } from "@/lib/recaps/types";
import { getScene } from "@/lib/recaps/scenes";

// ─────────────────────────────────────────────────────────────
// Palette — matches /og/profile/[username]/route.tsx
// ─────────────────────────────────────────────────────────────
const BG_DARK = "#0a0a0f";
const BG_CARD = "#1a1525";
const TEXT_PRIMARY = "#e4e4f0";
const TEXT_MUTED = "#9494a8";
const ACCENT = "#7c5cff";
const BG_PANEL = "#16161f";

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────
export interface RecapOgCardProps {
  payload: RecapPayload;
  username: string;
  /** When provided, renders the per-scene variant for payload.scenes[sceneIndex]. */
  sceneIndex?: number;
  /**
   * URL suffix for the footer link.
   * Examples: "year/2026", "month/202605"
   */
  urlSuffix: string;
}

// ─────────────────────────────────────────────────────────────
// Public builder
// ─────────────────────────────────────────────────────────────
export function RecapOgCard({
  payload,
  username,
  sceneIndex,
  urlSuffix,
}: RecapOgCardProps): ReactNode {
  const footerUrl = `ploxa.vercel.app/u/${username}/${urlSuffix}`;

  // Sparse data: render a calm "not enough data yet" card.
  if (payload.tier === "too_sparse") {
    return (
      <OgShell footerUrl={footerUrl}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            gap: 24,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              background: ACCENT,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              color: TEXT_PRIMARY,
            }}
          >
            ·_·
          </div>
          <div
            style={{
              fontSize: 36,
              fontWeight: 700,
              color: TEXT_PRIMARY,
              display: "flex",
            }}
          >
            Not enough data yet
          </div>
          <div
            style={{
              fontSize: 22,
              color: TEXT_MUTED,
              display: "flex",
            }}
          >
            Log more games and check back soon.
          </div>
        </div>
      </OgShell>
    );
  }

  // Per-scene card.
  if (sceneIndex !== undefined) {
    const sceneId = payload.scenes[sceneIndex];
    if (!sceneId) {
      // Out-of-range index — render summary fallback.
      return <SummaryHero payload={payload} footerUrl={footerUrl} />;
    }
    return (
      <OgShell footerUrl={footerUrl}>
        <SceneHero payload={payload} sceneId={sceneId} />
      </OgShell>
    );
  }

  // Summary card (no sceneIndex).
  return <SummaryHero payload={payload} footerUrl={footerUrl} />;
}

// ─────────────────────────────────────────────────────────────
// Shell: dark gradient + star-field accent + footer
// ─────────────────────────────────────────────────────────────
function OgShell({
  footerUrl,
  children,
}: {
  footerUrl: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: `linear-gradient(135deg, ${BG_DARK} 0%, ${BG_CARD} 100%)`,
        color: TEXT_PRIMARY,
        fontFamily: "system-ui",
        display: "flex",
        flexDirection: "column",
        padding: "52px 60px 44px",
        position: "relative",
      }}
    >
      {/* Star-field accent — a handful of small circles scattered in the bg */}
      <StarField />
      {/* Main content area */}
      <div style={{ display: "flex", flex: 1, flexDirection: "column" }}>
        {children}
      </div>
      {/* Footer */}
      <Footer footerUrl={footerUrl} />
    </div>
  );
}

/** Simple star-field: 8 dots at fixed positions — no randomness so Satori
 *  renders deterministically.  Kept as flat absolutely-positioned elements
 *  rather than SVG to avoid Satori SVG rendering quirks. */
function StarField(): ReactNode {
  const stars = [
    { top: 40, left: 900, r: 2 },
    { top: 80, left: 1050, r: 1.5 },
    { top: 140, left: 980, r: 2.5 },
    { top: 200, left: 1100, r: 1 },
    { top: 320, left: 1020, r: 2 },
    { top: 420, left: 1120, r: 1.5 },
    { top: 500, left: 950, r: 1 },
    { top: 560, left: 1070, r: 2 },
  ];
  return (
    <>
      {stars.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: s.top,
            left: s.left,
            width: s.r * 2,
            height: s.r * 2,
            borderRadius: "50%",
            background: "rgba(124, 92, 255, 0.4)",
            display: "flex",
          }}
        />
      ))}
    </>
  );
}

function Footer({ footerUrl }: { footerUrl: string }): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-end",
        marginTop: 24,
      }}
    >
      <div
        style={{
          fontSize: 18,
          color: TEXT_MUTED,
          display: "flex",
        }}
      >
        {footerUrl}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: ACCENT,
          fontFamily: "monospace",
          display: "flex",
          letterSpacing: 1,
        }}
      >
        Ploxa
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Summary hero: top game cover + 3 stats tiles
// ─────────────────────────────────────────────────────────────
function SummaryHero({
  payload,
  footerUrl,
}: {
  payload: RecapPayload;
  footerUrl: string;
}): ReactNode {
  const subject = payload.mode === "yearly" ? "Year" : "Month";
  const period =
    payload.mode === "yearly"
      ? new Date(payload.windowStart).getUTCFullYear().toString()
      : formatMonthLabel(payload.windowStart);

  return (
    <OgShell footerUrl={footerUrl}>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          flex: 1,
          gap: 48,
          alignItems: "center",
        }}
      >
        {/* Left: cover + title */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            flex: 1,
          }}
        >
          <div
            style={{
              fontSize: 22,
              color: TEXT_MUTED,
              textTransform: "uppercase",
              letterSpacing: 3,
              display: "flex",
            }}
          >
            {subject} in Games · {period}
          </div>
          {payload.goty ? (
            <div
              style={{
                display: "flex",
                flexDirection: "row",
                gap: 24,
                alignItems: "center",
              }}
            >
              {payload.goty.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
                <img
                  src={payload.goty.coverUrl}
                  width={140}
                  height={190}
                  style={{
                    borderRadius: 8,
                    objectFit: "cover",
                    flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 140,
                    height: 190,
                    background: BG_PANEL,
                    borderRadius: 8,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 40,
                    color: ACCENT,
                    flexShrink: 0,
                  }}
                >
                  ·_·
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div
                  style={{
                    fontSize: 14,
                    color: TEXT_MUTED,
                    textTransform: "uppercase",
                    letterSpacing: 2,
                    display: "flex",
                  }}
                >
                  Top game
                </div>
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 700,
                    color: TEXT_PRIMARY,
                    lineHeight: 1.2,
                    display: "flex",
                  }}
                >
                  {payload.goty.title}
                </div>
                <RatingChip rating={payload.goty.rating} />
              </div>
            </div>
          ) : (
            <div
              style={{
                fontSize: 48,
                fontWeight: 700,
                color: TEXT_PRIMARY,
                display: "flex",
              }}
            >
              {payload.totals.totalGames} games
            </div>
          )}
        </div>
        {/* Right: stats tiles */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            minWidth: 220,
          }}
        >
          <StatTile
            value={String(payload.totals.totalGames)}
            label="Games logged"
          />
          <StatTile
            value={payload.topGenre?.name ?? "varied"}
            label="Top genre"
          />
          <StatTile
            value={
              payload.totals.totalHoursPlayed != null
                ? `${payload.totals.totalHoursPlayed}h`
                : "no data"
            }
            label="Hours played"
          />
        </div>
      </div>
    </OgShell>
  );
}

// ─────────────────────────────────────────────────────────────
// Per-scene hero: switch on SceneId
// ─────────────────────────────────────────────────────────────
function SceneHero({
  payload,
  sceneId,
}: {
  payload: RecapPayload;
  sceneId: SceneId;
}): ReactNode {
  const caption =
    payload.captions[sceneId] ??
    (getScene(sceneId)?.fallbackTemplate(payload) ?? "");

  switch (sceneId) {
    // ── Big-number scenes ─────────────────────────────────────
    case "opening":
    case "stats_total":
    case "closing": {
      const number = String(payload.totals.totalGames);
      const label =
        sceneId === "opening"
          ? payload.mode === "yearly"
            ? "games this year"
            : "games this month"
          : sceneId === "stats_total"
            ? "total games logged"
            : "games — that was your " + payload.mode;
      return (
        <BigNumberHero number={number} label={label} caption={caption} />
      );
    }

    // ── Top games grid ────────────────────────────────────────
    case "top_games": {
      const games = payload.topGames.slice(0, 5);
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            gap: 24,
          }}
        >
          <SectionLabel>Your top games</SectionLabel>
          <div style={{ display: "flex", flexDirection: "row", gap: 16 }}>
            {games.map((g) => (
              <CoverTile key={g.gameId} game={g} height={200} />
            ))}
          </div>
          <Caption text={caption} />
        </div>
      );
    }

    // ── GOTY ─────────────────────────────────────────────────
    case "goty": {
      const game = payload.goty;
      if (!game) {
        return (
          <BigNumberHero
            number="—"
            label="Top-rated game"
            caption={caption}
          />
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            flex: 1,
            gap: 40,
            alignItems: "center",
          }}
        >
          <CoverTile game={game} height={300} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              flex: 1,
            }}
          >
            <SectionLabel>Top game</SectionLabel>
            <div
              style={{
                fontSize: 44,
                fontWeight: 700,
                color: TEXT_PRIMARY,
                lineHeight: 1.15,
                display: "flex",
              }}
            >
              {game.title}
            </div>
            <RatingChip rating={game.rating} />
            <Caption text={caption} />
          </div>
        </div>
      );
    }

    // ── Genre dominance — flat percent label, no SVG donut ───
    case "genre_dominance": {
      const genre = payload.topGenre;
      if (!genre) {
        return (
          <CenteredTextHero
            headline="Balanced tastes"
            caption={caption}
          />
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: 16,
          }}
        >
          <SectionLabel>Top genre</SectionLabel>
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: TEXT_PRIMARY,
              lineHeight: 1,
              display: "flex",
            }}
          >
            {genre.name}
          </div>
          {/* Flat percent label — Satori SVG support is finicky, so we skip
              the donut chart and use a bold text percent instead. */}
          <div
            style={{
              fontSize: 40,
              fontWeight: 700,
              color: ACCENT,
              display: "flex",
            }}
          >
            {genre.pct}%
          </div>
          <Caption text={caption} />
        </div>
      );
    }

    // ── Mechanic love + top_theme: name in display type ──────
    case "mechanic_love": {
      const name = payload.topMechanic?.name ?? "Many mechanics";
      return (
        <CenteredTextHero headline={name} caption={caption} />
      );
    }
    case "top_theme": {
      const name = payload.topTheme?.name ?? "Eclectic taste";
      return (
        <CenteredTextHero headline={name} caption={caption} />
      );
    }

    // ── Longest game + most_replayed: cover + name + stat ────
    case "longest_game": {
      const data = payload.longestGame;
      if (!data) {
        return (
          <CenteredTextHero headline="Brief sessions" caption={caption} />
        );
      }
      return (
        <GameStatHero
          game={data.game}
          stat={`${data.hoursPlayed}h`}
          statLabel="hours played"
          caption={caption}
        />
      );
    }
    case "most_replayed": {
      const data = payload.mostReplayed;
      if (!data) {
        return (
          <CenteredTextHero headline="No standout replays" caption={caption} />
        );
      }
      return (
        <GameStatHero
          game={data.game}
          stat={String(data.replayCount)}
          statLabel={data.replayCount === 1 ? "time replayed" : "times replayed"}
          caption={caption}
        />
      );
    }

    // ── Surprise: cover + title + rating delta ────────────────
    case "surprise": {
      const data = payload.surprise;
      if (!data) {
        return (
          <CenteredTextHero headline="No standout surprises" caption={caption} />
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            flex: 1,
            gap: 40,
            alignItems: "center",
          }}
        >
          <CoverTile game={data.game} height={260} />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              flex: 1,
            }}
          >
            <SectionLabel>Biggest surprise</SectionLabel>
            <div
              style={{
                fontSize: 40,
                fontWeight: 700,
                color: TEXT_PRIMARY,
                lineHeight: 1.2,
                display: "flex",
              }}
            >
              {data.game.title}
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: 16 }}>
              <RatingChip rating={data.game.rating} />
              <div
                style={{
                  fontSize: 20,
                  color: TEXT_MUTED,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                vs avg {data.baselineAvg.toFixed(1)}/5
              </div>
            </div>
            <div
              style={{
                fontSize: 20,
                color: TEXT_MUTED,
                display: "flex",
              }}
            >
              {data.surpriseGenre}
            </div>
            <Caption text={caption} />
          </div>
        </div>
      );
    }

    // ── Taste evolution: Q1 → Q4 pair ────────────────────────
    case "taste_evolution": {
      const evo = payload.tasteEvolution;
      if (!evo) {
        return (
          <CenteredTextHero headline="Steady taste" caption={caption} />
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: 24,
          }}
        >
          <SectionLabel>Taste evolution</SectionLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              gap: 32,
              alignItems: "center",
            }}
          >
            <VibeBox label="Q1" vibe={evo.q1Vibe} />
            <div
              style={{
                fontSize: 32,
                color: ACCENT,
                display: "flex",
              }}
            >
              to
            </div>
            <VibeBox label="Q4" vibe={evo.q4Vibe} />
          </div>
          <Caption text={caption} />
        </div>
      );
    }

    // ── Completion ratio: X% Completed | Y% Dropped ──────────
    case "completion_ratio": {
      const data = payload.completionRatio;
      if (!data) {
        return (
          <CenteredTextHero
            headline="Completion rate was hard to pin down"
            caption={caption}
          />
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: 24,
          }}
        >
          <SectionLabel>Completion</SectionLabel>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              gap: 48,
            }}
          >
            <PercentBlock pct={data.completedPct} label="Completed" />
            <PercentBlock pct={data.droppedPct} label="Dropped" />
          </div>
          <Caption text={caption} />
        </div>
      );
    }

    // ── Mood themes: up to 3 themes stacked ──────────────────
    case "mood_themes": {
      const themes = payload.moodThemes?.themes.slice(0, 3) ?? [];
      if (themes.length === 0) {
        return (
          <CenteredTextHero headline="Many moods" caption={caption} />
        );
      }
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            justifyContent: "center",
            gap: 20,
          }}
        >
          <SectionLabel>Mood themes</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {themes.map((t) => (
              <div
                key={t}
                style={{
                  fontSize: 40,
                  fontWeight: 700,
                  color: TEXT_PRIMARY,
                  display: "flex",
                }}
              >
                {t}
              </div>
            ))}
          </div>
          <Caption text={caption} />
        </div>
      );
    }

    // ── Reviews: X reviews this year ─────────────────────────
    case "reviews": {
      return (
        <BigNumberHero
          number={String(payload.totals.reviewCount)}
          label={
            payload.totals.reviewCount === 1 ? "review written" : "reviews written"
          }
          caption={caption}
        />
      );
    }

    // ── Fallback for future scene ids ─────────────────────────
    // TypeScript narrows `sceneId` to `never` here because the switch above
    // is exhaustive over the current SceneId union. The cast to `string` is
    // intentional: new scene ids added in future tasks will hit this path at
    // runtime without causing a build error, giving a readable fallback card
    // rather than a blank / broken image.
    default: {
      const unknownId = sceneId as string;
      return (
        <CenteredTextHero headline={unknownId.replace(/_/g, " ")} caption={caption} />
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Reusable sub-components
// ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      style={{
        fontSize: 18,
        color: TEXT_MUTED,
        textTransform: "uppercase",
        letterSpacing: 3,
        display: "flex",
      }}
    >
      {children}
    </div>
  );
}

function Caption({ text }: { text: string }): ReactNode {
  return (
    <div
      style={{
        fontSize: 22,
        color: TEXT_MUTED,
        lineHeight: 1.4,
        marginTop: 8,
        display: "flex",
      }}
    >
      {text}
    </div>
  );
}

function RatingChip({ rating }: { rating: number }): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        background: ACCENT,
        borderRadius: 6,
        padding: "4px 12px",
        fontSize: 20,
        fontWeight: 700,
        color: TEXT_PRIMARY,
        width: "fit-content",
      }}
    >
      {rating}/5
    </div>
  );
}

function StatTile({
  value,
  label,
}: {
  value: string;
  label: string;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: BG_PANEL,
        borderRadius: 10,
        padding: "16px 20px",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: TEXT_PRIMARY,
          display: "flex",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 16,
          color: TEXT_MUTED,
          textTransform: "uppercase",
          letterSpacing: 2,
          display: "flex",
        }}
      >
        {label}
      </div>
    </div>
  );
}

/** Cover art box or fallback placeholder. */
function CoverTile({
  game,
  height,
}: {
  game: TopGameRef;
  height: number;
}): ReactNode {
  const width = Math.round(height * 0.74); // ~3:4 ratio (RAWG covers)
  if (game.coverUrl) {
    return (
      // next/og's ImageResponse does not run the Next Image component.
      // Raw <img> is correct here — same convention as /og/profile/[username].
      // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
      <img
        src={game.coverUrl}
        width={width}
        height={height}
        style={{ borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width,
        height,
        background: BG_PANEL,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 36,
        color: ACCENT,
        flexShrink: 0,
      }}
    >
      ·_·
    </div>
  );
}

function BigNumberHero({
  number,
  label,
  caption,
}: {
  number: string;
  label: string;
  caption: string;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        justifyContent: "center",
        gap: 16,
      }}
    >
      <div
        style={{
          fontSize: 120,
          fontWeight: 800,
          color: TEXT_PRIMARY,
          lineHeight: 1,
          display: "flex",
        }}
      >
        {number}
      </div>
      <div
        style={{
          fontSize: 32,
          color: TEXT_MUTED,
          display: "flex",
        }}
      >
        {label}
      </div>
      <Caption text={caption} />
    </div>
  );
}

function CenteredTextHero({
  headline,
  caption,
}: {
  headline: string;
  caption: string;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 20,
      }}
    >
      <div
        style={{
          fontSize: 64,
          fontWeight: 800,
          color: TEXT_PRIMARY,
          lineHeight: 1.15,
          display: "flex",
        }}
      >
        {headline}
      </div>
      <Caption text={caption} />
    </div>
  );
}

function GameStatHero({
  game,
  stat,
  statLabel,
  caption,
}: {
  game: TopGameRef;
  stat: string;
  statLabel: string;
  caption: string;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        flex: 1,
        gap: 40,
        alignItems: "center",
      }}
    >
      <CoverTile game={game} height={260} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          flex: 1,
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 700,
            color: TEXT_PRIMARY,
            lineHeight: 1.2,
            display: "flex",
          }}
        >
          {game.title}
        </div>
        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: ACCENT,
            display: "flex",
          }}
        >
          {stat}
        </div>
        <div
          style={{
            fontSize: 22,
            color: TEXT_MUTED,
            display: "flex",
          }}
        >
          {statLabel}
        </div>
        <Caption text={caption} />
      </div>
    </div>
  );
}

function VibeBox({
  label,
  vibe,
}: {
  label: string;
  vibe: string;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: BG_PANEL,
        borderRadius: 10,
        padding: "16px 24px",
      }}
    >
      <div
        style={{
          fontSize: 18,
          color: ACCENT,
          textTransform: "uppercase",
          letterSpacing: 3,
          display: "flex",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: TEXT_PRIMARY,
          display: "flex",
        }}
      >
        {vibe}
      </div>
    </div>
  );
}

function PercentBlock({
  pct,
  label,
}: {
  pct: number;
  label: string;
}): ReactNode {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          fontSize: 80,
          fontWeight: 800,
          color: TEXT_PRIMARY,
          lineHeight: 1,
          display: "flex",
        }}
      >
        {pct}%
      </div>
      <div
        style={{
          fontSize: 22,
          color: TEXT_MUTED,
          display: "flex",
        }}
      >
        {label}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Format an ISO date string to a short month+year label, e.g. "May 2026". */
function formatMonthLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
