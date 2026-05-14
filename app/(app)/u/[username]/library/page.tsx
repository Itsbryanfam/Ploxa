import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { LibraryShelf } from "@/components/library/library-shelf";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { FilterChips } from "@/components/library/filter-chips";
import { SortDropdown } from "@/components/library/sort-dropdown";
import { LOG_GAME_SELECT } from "@/lib/logs/select";
import { mapRowToLibraryItem, type LibraryItem } from "@/lib/logs/library-item";
import { isBlockedBetween } from "@/lib/social/_shared/visibility";
import { LOG_STATUSES, type LogStatus } from "@/lib/db/schema-types";
import type { SortKey } from "@/lib/logs/server-actions";

const VALID_FILTERS = ["all", ...LOG_STATUSES] as const;
const VALID_SORTS = ["recent", "rating-desc", "rating-asc", "title-asc", "released-desc"] as const;

function parseFilter(s: string | undefined): LogStatus | "all" {
  return (VALID_FILTERS as readonly string[]).includes(s ?? "")
    ? (s as LogStatus | "all")
    : "all";
}
function parseSort(s: string | undefined): SortKey {
  return (VALID_SORTS as readonly string[]).includes(s ?? "")
    ? (s as SortKey)
    : "recent";
}

/**
 * Per-user public library page. Linked from the profile overview's
 * "Library — See all →" affordance. Mirrors the profile page's
 * privacy invariants (indistinguishable 404 for not-found / private +
 * non-owner / blocked-pair) and reuses the owner-library FilterChips +
 * SortDropdown components — both are URL-param-driven client islands
 * so this page stays a pure server render and a chip click is a
 * partial RSC navigation, not a re-fetch.
 *
 * Non-owners only see logs where is_private=false. The viewer's own
 * /library has additional view modes (list, stacks); we render only
 * the shelf here to keep public pages simple — that's the same shelf
 * the profile overview already shows in truncated form.
 */
const getUserLibraryPageData = cache(
  async (
    username: string,
    filter: LogStatus | "all",
    sort: SortKey,
  ) => {
    const viewer = await getCachedUser();
    const profile = await db.query.profiles.findFirst({
      where: and(eq(schema.profiles.username, username), isNull(schema.profiles.deletedAt)),
      columns: { userId: true, username: true, displayName: true, isPublic: true },
    });
    if (!profile) return null;

    const isOwner = viewer?.id === profile.userId;
    if (!profile.isPublic && !isOwner) return null;

    if (viewer && !isOwner) {
      if (await isBlockedBetween(viewer.id, profile.userId)) return null;
    }

    const visibilityWhere = and(
      eq(schema.logs.userId, profile.userId),
      isOwner ? undefined : eq(schema.logs.isPrivate, false),
      filter === "all" ? undefined : eq(schema.logs.status, filter),
    );

    const orderBy = (() => {
      switch (sort) {
        case "rating-desc":
          return desc(schema.logs.rating);
        case "rating-asc":
          return asc(schema.logs.rating);
        case "title-asc":
          return asc(schema.games.title);
        case "released-desc":
          return desc(schema.games.released);
        case "recent":
        default:
          return desc(schema.logs.updatedAt);
      }
    })();

    const rows = await db
      .select(LOG_GAME_SELECT)
      .from(schema.logs)
      .innerJoin(schema.games, eq(schema.logs.gameId, schema.games.id))
      .where(visibilityWhere)
      .orderBy(orderBy);

    const items: LibraryItem[] = rows.map((r) => mapRowToLibraryItem(r.log, r.game));
    return { profile, items };
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  // Metadata always uses defaults (no filter/sort) — search engines see the
  // canonical title regardless of which filter the visitor happens to land on.
  const data = await getUserLibraryPageData(username, "all", "recent");
  if (!data) return { title: "Ploxa" };
  const subject = data.profile.displayName ?? data.profile.username;
  return {
    title: `${subject}'s library`,
    description: `${subject} has logged ${data.items.length} game${data.items.length === 1 ? "" : "s"}.`,
  };
}

export default async function UserLibraryPage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  const [{ username }, { status, sort }] = await Promise.all([params, searchParams]);
  const filter = parseFilter(status);
  const sortKey = parseSort(sort);

  const data = await getUserLibraryPageData(username, filter, sortKey);
  if (!data) notFound();
  const { profile, items } = data;
  const subject = profile.displayName ?? profile.username;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <p className="text-sm text-[var(--text-dim)]">@{profile.username}</p>
        <h1 className="text-3xl font-bold mt-1">{subject}&apos;s library</h1>
        <p className="text-sm text-[var(--text-dim)] mt-2">
          {items.length} game{items.length === 1 ? "" : "s"}
          {filter === "all" ? " logged" : ` · ${filter.replace("_", " ")}`}.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips />
        <SortDropdown />
      </div>

      {items.length > 0 ? (
        <ShelfFrame>
          <LibraryShelf items={items} filter={filter} />
        </ShelfFrame>
      ) : (
        <p className="text-sm text-[var(--text-dim)]">
          {filter === "all"
            ? "No games logged yet."
            : `No games in ${filter.replace("_", " ")}.`}
        </p>
      )}
    </div>
  );
}
