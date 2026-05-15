import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { Pageant } from "@/components/recaps/Pageant";
import { SparseDataState } from "@/components/recaps/SparseDataState";
import { cacheOrBuildMonthly } from "@/lib/recaps/cache-or-build";
import { getProfileByUsername } from "@/lib/profile/server-actions";
import { getCachedUser } from "@/lib/supabase/auth-cache";

/**
 * /u/[username]/month/[yyyymm] — monthly mini-recap page.
 *
 * Phase 6 T16. Mirrors the yearly recap page (`year/[year]/page.tsx`) with:
 *   - `[yyyymm]` param in YYYYMM format (e.g. "202605" = May 2026)
 *   - `cacheOrBuildMonthly` instead of `cacheOrBuildYearly`
 *   - mode="monthly" passed to Pageant + SparseDataState
 *   - OG path: /og/month/[username]/[yyyymm]
 *
 * Privacy gate: private profiles return 404 to non-owners. Same binary
 * public/private model as the yearly page and taste page.
 *
 * yyyymm validation: length 6, all digits, year 2020<x<2100, month 1-12.
 * Returns null for any invalid input; caller calls notFound().
 *
 * monthIndex is 1-based throughout (1=January … 12=December), matching the
 * plan convention, the DB schema, and `monthWindow()`.
 *
 * The shared loader is React.cache()-wrapped so generateMetadata and the
 * page body collapse to one set of DB queries per request.
 */
interface PageProps {
  params: Promise<{ username: string; yyyymm: string }>;
  searchParams: Promise<{ scene?: string }>;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Parse + validate the yyyymm segment. Returns {year, monthIndex} (1-based)
 * on success, null for any invalid input.
 *
 * Rules: exactly 6 digits, year 2020<x<2100, month 1-12.
 */
function parseYyyymm(raw: string): { year: number; monthIndex: number } | null {
  if (raw.length !== 6 || !/^\d{6}$/.test(raw)) return null;
  const year = Number.parseInt(raw.slice(0, 4), 10);
  const monthIndex = Number.parseInt(raw.slice(4, 6), 10);
  // Year range: same bounds as the yearly page (2020 < year < 2100).
  if (year <= 2020 || year >= 2100) return null;
  if (monthIndex < 1 || monthIndex > 12) return null;
  return { year, monthIndex };
}

/**
 * Shared (profile, viewer, payload) loader. Returns null when:
 *   - profile not found or soft-deleted
 *   - profile is private and viewer is not the owner
 * Both metadata and the page body see null and handle identically.
 */
const getMonthPageData = cache(
  async (username: string, year: number, monthIndex: number) => {
    const profile = await getProfileByUsername(username);
    if (!profile) return null;

    const viewer = await getCachedUser();
    const isOwner = viewer?.id === profile.userId;
    if (!profile.isPublic && !isOwner) return null;

    const { payload, lockedAt } = await cacheOrBuildMonthly({
      userId: profile.userId,
      year,
      monthIndex,
    });
    return { profile, viewer, isOwner, payload, lockedAt };
  },
);

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { username, yyyymm } = await params;
  const { scene } = await searchParams;
  const parsed = parseYyyymm(yyyymm);
  if (parsed === null) return { title: "Ploxa" };

  const { year, monthIndex } = parsed;
  const data = await getMonthPageData(username, year, monthIndex);
  if (!data) return { title: "Ploxa" };

  const { profile } = data;
  const subject = profile.displayName ?? profile.username;
  const monthName = MONTH_NAMES[monthIndex - 1];
  const sceneIdx = scene && /^\d+$/.test(scene) ? scene : null;
  const ogPath = sceneIdx
    ? `/og/month/${profile.username}/${yyyymm}/scene/${sceneIdx}`
    : `/og/month/${profile.username}/${yyyymm}`;
  const title = `${subject}'s ${monthName} ${year} in games`;
  return {
    title,
    openGraph: {
      title,
      images: [ogPath],
      type: "article",
      url: `/u/${profile.username}/month/${yyyymm}`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: [ogPath],
    },
  };
}

export default async function MonthPage({ params, searchParams }: PageProps) {
  const { username, yyyymm } = await params;
  const { scene } = await searchParams;

  const parsed = parseYyyymm(yyyymm);
  if (parsed === null) notFound();

  const { year, monthIndex } = parsed;
  const data = await getMonthPageData(username, year, monthIndex);
  if (!data) notFound();

  const { payload } = data; // lockedAt present in data but not used on monthly page

  // Sparse-data tier: SparseDataState handles its own layout. cacheOrBuildMonthly
  // returned too_sparse WITHOUT writing a row — once the user adds enough logs
  // for this month, the next page load will unlock the full monthly recap.
  if (payload.tier === "too_sparse") {
    return <SparseDataState username={username} mode="monthly" />;
  }

  // `scene` is the deep-link target index, e.g. /month/202605?scene=2.
  // Non-numeric values silently fall back to 0.
  const initialSceneIndex =
    scene && /^\d+$/.test(scene) ? Number.parseInt(scene, 10) : 0;

  return (
    <Pageant
      payload={payload}
      mode="monthly"
      initialSceneIndex={initialSceneIndex}
    />
  );
}
