import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Catalog row only — no RAWG-on-miss enrichment here. Unfurlers should not
  // be able to trigger RAWG free-tier quota burn by sharing a not-yet-cached
  // slug. If the row isn't in the catalog yet, 404 — the canonical page's
  // first authenticated visitor will populate it via getGameDetailBySlug.
  const game = await db.query.games.findFirst({
    where: eq(schema.games.slug, slug),
    columns: {
      id: true,
      slug: true,
      title: true,
      released: true,
      coverUrl: true,
      posterUrl: true,
      description: true,
      genres: true,
      metacriticScore: true,
      rawgRating: true,
    },
  });
  if (!game) return new Response("Not found", { status: 404 });

  const releaseYear = game.released ? game.released.getFullYear() : null;
  const titleClipped =
    game.title.length > 60 ? `${game.title.slice(0, 60).trimEnd()}…` : game.title;

  // Hero art: prefer landscape coverUrl (RAWG bg image); fall back to portrait
  // posterUrl rendered at the cover slot. Both are cached via Next image
  // remotePatterns + this OG route's response cache.
  const heroSrc = game.coverUrl ?? game.posterUrl;

  // Description excerpt with sane fallback to genres so wireless-thin RAWG
  // entries (description = "") still render something meaningful below the
  // title. Keep it short — Satori has no auto-truncation.
  const desc = game.description?.trim();
  const blurb = desc?.length
    ? desc.length > 200
      ? `${desc.slice(0, 200).trimEnd()}…`
      : desc
    : game.genres?.length
      ? game.genres.slice(0, 3).join(" · ")
      : "";

  // Score badge: prefer Metacritic (more recognized), fall back to RAWG rating.
  const scoreLabel = game.metacriticScore != null
    ? `MC ${game.metacriticScore}`
    : game.rawgRating != null
      ? `${Number(game.rawgRating).toFixed(1)}`
      : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0a0a0f 0%, #1a1525 100%)",
          color: "#e4e4f0",
          padding: "60px",
          display: "flex",
          flexDirection: "row",
          gap: "48px",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 48,
                height: 48,
                background: "#7c5cff",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
              }}
            >
              ·_·
            </div>
            <div
              style={{
                fontSize: 20,
                opacity: 0.65,
                textTransform: "uppercase",
                letterSpacing: 2,
                display: "flex",
              }}
            >
              Ploxa
            </div>
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, display: "flex" }}>
            {titleClipped}
          </div>
          <div style={{ display: "flex", flexDirection: "row", gap: 24, alignItems: "center" }}>
            {releaseYear != null && (
              <div style={{ fontSize: 22, opacity: 0.7, display: "flex" }}>{releaseYear}</div>
            )}
            {scoreLabel && (
              <div
                style={{
                  fontSize: 18,
                  background: "#7c5cff",
                  color: "#ffffff",
                  padding: "4px 12px",
                  borderRadius: 6,
                  display: "flex",
                }}
              >
                {scoreLabel}
              </div>
            )}
          </div>
          <div
            style={{
              fontSize: 22,
              opacity: 0.85,
              lineHeight: 1.4,
              maxWidth: 580,
              display: "flex",
              marginTop: "auto",
            }}
          >
            {blurb}
          </div>
        </div>
        {heroSrc ? (
          // next/og's ImageResponse does not run the Next Image component;
          // raw <img> is correct. Same convention as /og/review/[id].
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            src={heroSrc}
            width={300}
            height={420}
            style={{ borderRadius: 12, objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: 300,
              height: 420,
              background: "#16161f",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 96,
              color: "#7c5cff",
            }}
          >
            ·_·
          </div>
        )}
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, s-maxage=86400, max-age=86400",
      },
    },
  );
}
