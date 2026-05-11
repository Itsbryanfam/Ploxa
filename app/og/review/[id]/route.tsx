import { ImageResponse } from "next/og";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const review = await db.query.reviews.findFirst({
    where: and(
      eq(schema.reviews.id, id),
      eq(schema.reviews.isPublic, true),
      isNotNull(schema.reviews.publishedAt),
    ),
    columns: { id: true, body: true, rating: true, userId: true, gameId: true },
  });
  if (!review) return new Response("Not found", { status: 404 });

  const [profile, game] = await Promise.all([
    db.query.profiles.findFirst({
      where: eq(schema.profiles.userId, review.userId),
      columns: { username: true },
    }),
    db.query.games.findFirst({
      where: eq(schema.games.id, review.gameId),
      columns: { title: true, coverUrl: true },
    }),
  ]);
  if (!profile || !game) return new Response("Not found", { status: 404 });

  const hook = (review.body ?? "").split("\n\n")[0] ?? "";
  const hookSnippet = hook.length > 180 ? `${hook.slice(0, 180).trimEnd()}…` : hook;
  const ratingNum = review.rating != null ? Number(review.rating) : null;
  const ratingStr = ratingNum != null ? `${ratingNum.toFixed(1)} / 10` : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #0c0c14 0%, #1a1525 100%)",
          color: "#f1efff",
          padding: "60px",
          display: "flex",
          flexDirection: "row",
          gap: "48px",
          fontFamily: "system-ui",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {/* Pixel mascot placeholder — Phase 7 will swap for the final sprite */}
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
            <div style={{ fontSize: 24, opacity: 0.65, display: "flex" }}>@{profile.username}</div>
          </div>
          <div style={{ fontSize: 56, fontWeight: 700, lineHeight: 1.1, display: "flex" }}>
            {game.title}
          </div>
          <div style={{ fontSize: 28, opacity: 0.8, display: "flex" }}>{ratingStr}</div>
          <div
            style={{
              fontSize: 24,
              opacity: 0.85,
              fontStyle: "italic",
              maxWidth: 700,
              lineHeight: 1.4,
              display: "flex",
            }}
          >
            &quot;{hookSnippet}&quot;
          </div>
        </div>
        {game.coverUrl ? (
          // next/og's ImageResponse does not run the Next Image component;
          // raw <img> is the correct choice here.
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            src={game.coverUrl}
            width={240}
            height={360}
            style={{ borderRadius: 12, objectFit: "cover" }}
          />
        ) : (
          <div style={{ width: 240, height: 360, background: "#2a2438", borderRadius: 12, display: "flex" }} />
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
