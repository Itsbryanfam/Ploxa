import { ImageResponse } from "next/og";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Fetch list + privacy gate. The list itself must be public+published, AND
  // the owning profile must be public — same defense-in-depth contract as
  // /og/review/[id]: this endpoint is reachable by unauthenticated unfurlers
  // (Twitter, Discord, etc.) and we don't want to leak private data here even
  // if the list happens to be flagged public.
  const list = await db.query.lists.findFirst({
    where: and(
      eq(schema.lists.id, id),
      eq(schema.lists.isPublic, true),
      isNotNull(schema.lists.publishedAt),
    ),
    columns: { id: true, title: true, description: true, userId: true },
  });
  if (!list) return new Response("Not found", { status: 404 });

  const profile = await db.query.profiles.findFirst({
    where: and(eq(schema.profiles.userId, list.userId), isNull(schema.profiles.deletedAt)),
    columns: { username: true, displayName: true, isPublic: true },
  });
  if (!profile || !profile.isPublic) return new Response("Not found", { status: 404 });

  // Pull the first 4 covers + total count in parallel — a small mosaic that
  // reads well at 1200x630. LIMIT 4 keeps the response light.
  const [covers, [countRow]] = await Promise.all([
    db
      .select({
        coverUrl: schema.games.coverUrl,
        title: schema.games.title,
      })
      .from(schema.listItems)
      .innerJoin(schema.games, eq(schema.games.id, schema.listItems.gameId))
      .where(eq(schema.listItems.listId, list.id))
      .orderBy(asc(schema.listItems.position))
      .limit(4),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.listItems)
      .where(eq(schema.listItems.listId, list.id)),
  ]);
  const total = countRow?.count ?? covers.length;

  const subject = profile.displayName ?? profile.username;
  const titleClipped = list.title.length > 56 ? `${list.title.slice(0, 56).trimEnd()}…` : list.title;
  const description = list.description?.trim().length
    ? list.description.trim()
    : `${total} game${total === 1 ? "" : "s"}`;
  const descClipped = description.length > 200 ? `${description.slice(0, 200).trimEnd()}…` : description;

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
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 20 }}>
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
            <div style={{ fontSize: 20, opacity: 0.65, display: "flex" }}>
              a list by @{profile.username}
            </div>
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, display: "flex" }}>
            {titleClipped}
          </div>
          <div
            style={{
              fontSize: 22,
              opacity: 0.85,
              maxWidth: 560,
              lineHeight: 1.4,
              display: "flex",
            }}
          >
            {descClipped}
          </div>
          <div
            style={{
              marginTop: "auto",
              fontSize: 18,
              opacity: 0.6,
              textTransform: "uppercase",
              letterSpacing: 2,
              display: "flex",
            }}
          >
            {total} {total === 1 ? "game" : "games"} · {subject}
          </div>
        </div>
        {/* 2x2 cover mosaic via nested flex rows — Satori (next/og) doesn't
            support CSS Grid, so the mosaic is built from two flex rows. Pads
            with placeholders when fewer than 4 items exist. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 2].map((rowStart) => (
            <div key={rowStart} style={{ display: "flex", flexDirection: "row", gap: 12 }}>
              {[rowStart, rowStart + 1].map((i) => {
                const c = covers[i];
                if (c?.coverUrl) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
                    <img
                      key={i}
                      src={c.coverUrl}
                      width={180}
                      height={270}
                      style={{ borderRadius: 8, objectFit: "cover" }}
                    />
                  );
                }
                return (
                  <div
                    key={i}
                    style={{
                      width: 180,
                      height: 270,
                      background: "#16161f",
                      borderRadius: 8,
                      display: "flex",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
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
