import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Pageant } from "@/components/recaps/Pageant";
import { SparseDataState } from "@/components/recaps/SparseDataState";
import { cacheOrBuildYearly } from "@/lib/recaps/cache-or-build";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { getCachedUser } from "@/lib/supabase/auth-cache";

const CURRENT_YEAR = new Date().getUTCFullYear();

/**
 * /u/[username]/year/[year] — canonical year-in-review page.
 *
 * Phase 6 T11. The cache-or-build flow lives in
 * `lib/recaps/cache-or-build.ts` (`cacheOrBuildYearly`) so it can be unit
 * tested without spinning up Next; this file is the integration point
 * that wires the auth/privacy gate, the URL → window mapping, and the
 * Pageant/SparseDataState branch.
 *
 * Privacy gate matches `app/(app)/u/[username]/taste/page.tsx`: private
 * profiles return 404 to non-owners. The plan's "404 for non-followers"
 * phrasing was aspirational — the codebase uses a binary public/private
 * model (audit T01 introduced the redact helper but didn't add a
 * follower-gated tier).
 *
 * Year range: 2020 < year < 2100. 2020 is a safe lower bound (the site
 * didn't exist before 2024 but rounding back gives users room to backfill
 * historical play data). 2100 is generous future-proofing.
 *
 * Metadata: `generateMetadata` reads `?scene` from the URL and points OG
 * at `/og/year/.../scene/{n}` so deep-linked shares (e.g. "scene 4 of my
 * 2026 year") get a scene-specific unfurl card. T15 implements the OG
 * routes; until then the URL just 404s on Vercel, which is acceptable.
 *
 * The shared loader is React.cache()-wrapped so generateMetadata and the
 * page body collapse to one set of DB queries per request — same pattern
 * as the taste page (lib/profile/server-actions.ts → React.cache).
 */
interface PageProps {
  params: Promise<{ username: string; year: string }>;
  searchParams: Promise<{ scene?: string }>;
}

const MIN_YEAR = 2020;
const MAX_YEAR = 2100;

/**
 * Parse + validate the year segment. Returns null for non-integer or
 * out-of-range values so the caller can `notFound()`.
 */
function parseYear(raw: string): number | null {
  const year = Number.parseInt(raw, 10);
  if (!Number.isInteger(year) || year <= MIN_YEAR || year >= MAX_YEAR) {
    return null;
  }
  return year;
}

/**
 * Shared (profile, viewer, payload) loader. Returns null for the same
 * conditions the page-body 404s on:
 *   - profile not found (or soft-deleted)
 *   - profile is private + viewer is not owner
 * Both metadata and the page body see null and fall back identically
 * (metadata to a bare title; the body to notFound()).
 */
const getYearPageData = cache(async (username: string, year: number) => {
  const profile = await getProfileByUsername(username);
  if (!profile) return null;

  const viewer = await getCachedUser();
  const isOwner = viewer?.id === profile.userId;
  if (!profile.isPublic && !isOwner) return null;

  const { payload, lockedAt } = await cacheOrBuildYearly({ userId: profile.userId, year });
  return { profile, viewer, isOwner, payload, lockedAt };
});

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { username, year: yearStr } = await params;
  const { scene } = await searchParams;
  const year = parseYear(yearStr);
  if (year === null) return { title: "Ploxa" };

  const data = await getYearPageData(username, year);
  if (!data) return { title: "Ploxa" };

  const { profile } = data;
  const subject = profile.displayName ?? profile.username;
  // OG paths are convention-only at T11. T15 will implement the real
  // /og/year/[username]/[year] (and /scene/[i]) routes; until then these
  // URLs resolve to a placeholder image on the platform. The shape lets
  // T15 land without touching this file.
  const sceneIdx = scene && /^\d+$/.test(scene) ? scene : null;
  const ogPath = sceneIdx
    ? `/og/year/${profile.username}/${year}/scene/${sceneIdx}`
    : `/og/year/${profile.username}/${year}`;
  const title = `${subject}'s ${year} in games`;
  return {
    title,
    openGraph: {
      title,
      images: [ogPath],
      type: "article",
      url: `/u/${profile.username}/year/${year}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: [ogPath],
    },
  };
}

export default async function YearPage({ params, searchParams }: PageProps) {
  const { username, year: yearStr } = await params;
  const { scene } = await searchParams;

  const year = parseYear(yearStr);
  if (year === null) notFound();

  const data = await getYearPageData(username, year);
  if (!data) notFound();

  const { payload, lockedAt, isOwner } = data;

  // Sparse-data tier: SparseDataState handles its own mascot + CTA layout.
  // cacheOrBuildYearly returned `too_sparse` WITHOUT writing a row, so the
  // next visit re-evaluates from scratch — once the user adds enough logs,
  // they unlock the full recap on the next page load.
  if (payload.tier === "too_sparse") {
    return <SparseDataState username={username} mode="yearly" />;
  }

  // canRefresh: current-year owner can re-run the aggregator (T20).
  // Only offered when the recap is not locked (locked = finalized for the year).
  const canRefresh = isOwner && year === CURRENT_YEAR && !lockedAt && payload.tier === "ok";

  // `scene` is the deep-link target index, e.g. /year/2026?scene=3. T12
  // wires this into Pageant's initial state. Non-numeric values silently
  // fall back to 0 — failed deep links should still render the recap
  // from the top, not 404.
  const initialSceneIndex =
    scene && /^\d+$/.test(scene) ? Number.parseInt(scene, 10) : 0;

  return (
    <Pageant
      payload={payload}
      mode="yearly"
      initialSceneIndex={initialSceneIndex}
      canRefresh={canRefresh}
      year={year}
    />
  );
}
