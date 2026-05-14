import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { MetadataRoute } from "next";

import { db } from "@/lib/db";
import { games, lists, profiles } from "@/lib/db/schema";
import { env } from "@/lib/env";

// Next.js 16 file convention. Served at /sitemap.xml.
// https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
//
// Caps: a single sitemap.xml can hold up to 50,000 URLs / 50 MB. Catalog is
// ~5K games today, profiles/lists are dwarfed by that. If `games` ever
// crosses ~40K we should split into chunked sitemaps via generateSitemaps.
export const revalidate = 3600; // Re-run hourly; trade-off vs. crawler freshness

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;

  // Static marketing routes — always present.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/login`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/signup`, changeFrequency: "monthly", priority: 0.5 },
  ];

  // Public profiles. is_public must be true and the profile must not be soft-deleted.
  const publicProfiles = await db
    .select({ username: profiles.username, updatedAt: profiles.updatedAt })
    .from(profiles)
    .where(and(eq(profiles.isPublic, true), isNull(profiles.deletedAt)));

  const profileRoutes: MetadataRoute.Sitemap = publicProfiles.map((p) => ({
    url: `${baseUrl}/u/${p.username}`,
    lastModified: p.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  // Published, public lists. Need both is_public AND a non-null published_at
  // (drafts have published_at = null).
  const publishedLists = await db
    .select({
      slug: lists.slug,
      username: profiles.username,
      updatedAt: lists.updatedAt,
    })
    .from(lists)
    .innerJoin(profiles, eq(profiles.userId, lists.userId))
    .where(
      and(
        eq(lists.isPublic, true),
        isNotNull(lists.publishedAt),
        eq(profiles.isPublic, true),
        isNull(profiles.deletedAt),
      ),
    );

  const listRoutes: MetadataRoute.Sitemap = publishedLists.map((l) => ({
    url: `${baseUrl}/u/${l.username}/lists/${l.slug}`,
    lastModified: l.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  // Game catalog — every cached game has a public detail page.
  const allGames = await db
    .select({ slug: games.slug, cachedAt: games.cachedAt })
    .from(games);

  const gameRoutes: MetadataRoute.Sitemap = allGames.map((g) => ({
    url: `${baseUrl}/games/${g.slug}`,
    lastModified: g.cachedAt,
    changeFrequency: "monthly" as const,
    priority: 0.4,
  }));

  return [...staticRoutes, ...profileRoutes, ...listRoutes, ...gameRoutes];
}
