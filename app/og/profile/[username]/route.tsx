import { ImageResponse } from "next/og";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;

  const profile = await db.query.profiles.findFirst({
    where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
    columns: {
      userId: true,
      username: true,
      displayName: true,
      isPublic: true,
      profilePictureUrl: true,
    },
  });
  // Same privacy contract as /og/review/[id] — this endpoint is reachable by
  // unauthenticated unfurlers (Twitter, Discord, etc.), so private profiles
  // 404 here even though the in-app page would render for the owner.
  if (!profile) return new Response("Not found", { status: 404 });
  if (!profile.isPublic) return new Response("Not found", { status: 404 });

  // Counts mirror the page-body StatsStrip but kept tiny — only the three
  // headline numbers the description text uses. count(*) FILTER reads from
  // logs by user; matches getProfileSummary's aggregate shape.
  const visibilityWhere = and(
    eq(schema.logs.userId, profile.userId),
    // Unfurlers are not the owner — non-owner only sees public logs.
    eq(schema.logs.isPrivate, false),
  );
  const [aggregate] = await db
    .select({
      completed: sql<number>`count(*) FILTER (WHERE ${schema.logs.status} = 'completed')::int`,
      playing: sql<number>`count(*) FILTER (WHERE ${schema.logs.status} = 'playing')::int`,
      backlog: sql<number>`count(*) FILTER (WHERE ${schema.logs.status} = 'backlog')::int`,
    })
    .from(schema.logs)
    .where(visibilityWhere);
  const completed = aggregate?.completed ?? 0;
  const playing = aggregate?.playing ?? 0;
  const backlog = aggregate?.backlog ?? 0;

  const subject = profile.displayName ?? profile.username;

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
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Pixel mascot placeholder (matches /og/review/[id] convention). */}
            <div
              style={{
                width: 64,
                height: 64,
                background: "#7c5cff",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}
            >
              ·_·
            </div>
            <div style={{ fontSize: 24, opacity: 0.65, display: "flex" }}>
              @{profile.username}
            </div>
          </div>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, display: "flex" }}>
            {subject}
          </div>
          <div style={{ display: "flex", flexDirection: "row", gap: 40, marginTop: "auto" }}>
            <Stat n={completed} label="completed" />
            <Stat n={playing} label="playing" />
            <Stat n={backlog} label="backlog" />
          </div>
        </div>
        {profile.profilePictureUrl ? (
          // next/og's ImageResponse does not run the Next Image component;
          // raw <img> is correct. Same convention as /og/review/[id].
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            src={profile.profilePictureUrl}
            width={320}
            height={320}
            style={{ borderRadius: 16, objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              width: 320,
              height: 320,
              background: "#16161f",
              borderRadius: 16,
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
        // Match the /og/review/[id] cache shape — 24h public; the underlying
        // counts shift on log changes but a one-day staleness ceiling is fine
        // for share-card content.
        "cache-control": "public, s-maxage=86400, max-age=86400",
      },
    },
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 40, fontWeight: 700, color: "#e4e4f0", display: "flex" }}>{n}</div>
      <div
        style={{
          fontSize: 18,
          color: "#9494a8",
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
