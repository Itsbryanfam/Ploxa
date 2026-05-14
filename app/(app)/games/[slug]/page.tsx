import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";

import { getGameDetailBySlug, getScreenshots } from "@/lib/games/server-actions";
import { getGameDetailUserState } from "@/lib/logs/server-actions";
import { GameDetail } from "@/components/game/game-detail";
import { AddToListModal } from "@/components/lists/add-to-list-modal";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db, schema } from "@/lib/db";

/**
 * Metadata-only loader — reads the games row directly without going through
 * getGameDetailBySlug's auth-walled + RAWG-on-miss + freshness-check path.
 * Wrapped in cache() so generateMetadata + the page body share one read for
 * the catalog-hit case (the dominant path).
 *
 * Returns null when the game isn't in the catalog yet (a fresh RAWG-on-miss
 * happens on the page body's getGameDetailBySlug call). Metadata for a
 * never-cached slug falls back to the root template — we deliberately don't
 * trigger RAWG enrichment from generateMetadata because (a) it adds latency
 * to the head, and (b) generateMetadata can be called by unfurlers without
 * cookies and we don't want to expose RAWG quota burn there.
 *
 * Same pattern as the canonical review page — extract the smallest cache-
 * deduped slice that both metadata and body need.
 */
const getGameMetadata = cache(async (slug: string) => {
  return await db.query.games.findFirst({
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
    },
  });
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = await getGameMetadata(slug);
  // Fresh slugs not yet in the catalog → fall back to the root title. The
  // page body's getGameDetailBySlug() will RAWG-on-miss insert the row, but
  // metadata runs first and we don't want to gate metadata on the slow path.
  if (!game) return { title: "Letterboxd for Games" };
  const releaseYear = game.released ? game.released.getFullYear() : null;
  const subject = releaseYear ? `${game.title} (${releaseYear})` : game.title;
  const title = subject;
  // Description preference: catalog description excerpt (what RAWG gave us) →
  // genre summary fallback (works even before RAWG description backfill).
  const descSrc = game.description?.trim();
  const description = descSrc?.length
    ? descSrc.slice(0, 200)
    : game.genres?.length
      ? `${game.title} — ${game.genres.slice(0, 3).join(", ")} on Letterboxd for Games`
      : `${game.title} on Letterboxd for Games`;
  const ogImage = `/og/game/${game.slug}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [ogImage],
      type: "article",
      url: `/games/${game.slug}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let game;
  try {
    game = await getGameDetailBySlug(slug);
  } catch {
    notFound();
  }

  // Two round-trips total: (1) Redis-backed RAWG screenshots, (2) one combined
  // SQL query for log + published review. Previously this was three (separate
  // log query + separate review query) running in parallel on Promise.all.
  const [screenshots, { log, ownReview }, viewer] = await Promise.all([
    getScreenshots(game.id),
    getGameDetailUserState(game.id, game),
    getCachedUser(),
  ]);

  // Load the viewer's lists for the AddToListModal (owner lists, up to 50).
  let userLists: Array<{ id: string; title: string; slug: string; publishedAt: Date | null }> = [];
  if (viewer) {
    userLists = await db
      .select({
        id: schema.lists.id,
        title: schema.lists.title,
        slug: schema.lists.slug,
        publishedAt: schema.lists.publishedAt,
      })
      .from(schema.lists)
      .where(eq(schema.lists.userId, viewer.id))
      .orderBy(desc(schema.lists.updatedAt))
      .limit(50);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <GameDetail
        game={{
          id: game.id,
          slug: game.slug,
          title: game.title,
          coverUrl: game.coverUrl,
          released: game.released,
          description: game.description,
          genres: game.genres,
          platforms: game.platforms,
          metacriticScore: game.metacriticScore,
          rawgRating: game.rawgRating,
        }}
        screenshots={screenshots}
        log={log}
        ownReview={ownReview}
      />

      {/* Add to list — shown only to authenticated users */}
      {viewer && (
        <div className="mt-4">
          <AddToListModal
            gameId={game.id}
            gameTitle={game.title}
            userLists={userLists}
          />
        </div>
      )}
    </div>
  );
}
