import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getUserLibrary, type SortKey } from "@/lib/logs/server-actions";
import { LibraryViewSwitcher } from "@/components/library/library-view-switcher";
import type { LogStatus } from "@/lib/db/schema-types";

export const metadata = { title: "Library — Letterboxd for Games" };

const VALID_FILTERS = ["all", "backlog", "playing", "completed", "dropped", "on_hold", "wishlist"] as const;
const VALID_SORTS = ["recent", "rating-desc", "rating-asc", "title-asc", "released-desc"] as const;

function asFilter(s: string | null | undefined): LogStatus | "all" {
  return (VALID_FILTERS as readonly string[]).includes(s ?? "") ? (s as LogStatus | "all") : "all";
}
function asSort(s: string | null | undefined): SortKey {
  return (VALID_SORTS as readonly string[]).includes(s ?? "") ? (s as SortKey) : "recent";
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string; view?: string }>;
}) {
  const sp = await searchParams;

  // Phase 1.5.13: old ?view=grid → new ?view=shelf (which is now the default,
  // so we just drop the param). Preserves any other query params.
  if (sp.view === "grid") {
    const others = new URLSearchParams();
    if (sp.status) others.set("status", sp.status);
    if (sp.sort) others.set("sort", sp.sort);
    const qs = others.toString();
    redirect(qs ? `/library?${qs}` : "/library");
  }

  const filter = asFilter(sp.status);
  const sort = asSort(sp.sort);
  const initialData = await getUserLibrary({ status: filter, sort });

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Library</h1>
        <p className="text-sm text-[var(--text-dim)]">Your games, your shelf.</p>
      </header>
      <Suspense
        fallback={<div className="text-sm text-[var(--text-faint)]">Loading library...</div>}
      >
        <LibraryViewSwitcher
          initialData={initialData}
          initialFilter={filter}
          initialSort={sort}
        />
      </Suspense>
    </div>
  );
}
