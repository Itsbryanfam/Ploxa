"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { getUserLibrary, type LibraryItem, type SortKey } from "@/lib/logs/server-actions";
import { LibraryShelf } from "./library-shelf";
import { LibraryList } from "./library-list";
import { StatusStacks } from "./status-stacks";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { FilterChips } from "./filter-chips";
import { SortDropdown } from "./sort-dropdown";
import type { LogStatus } from "@/lib/db/schema-types";
import { cn } from "@/lib/utils";

type View = "shelf" | "list" | "stacks";

const VALID_VIEWS = ["shelf", "list", "stacks"] as const;
const VALID_FILTERS = ["all", "backlog", "playing", "completed", "dropped", "on_hold", "wishlist"] as const;
const VALID_SORTS = ["recent", "rating-desc", "rating-asc", "title-asc", "released-desc"] as const;

function asView(s: string | null): View {
  return (VALID_VIEWS as readonly string[]).includes(s ?? "") ? (s as View) : "shelf";
}
function asFilter(s: string | null): LogStatus | "all" {
  return (VALID_FILTERS as readonly string[]).includes(s ?? "") ? (s as LogStatus | "all") : "all";
}
function asSort(s: string | null): SortKey {
  return (VALID_SORTS as readonly string[]).includes(s ?? "") ? (s as SortKey) : "recent";
}

interface Props {
  initialData: LibraryItem[];
  initialFilter: LogStatus | "all";
  initialSort: SortKey;
}

export function LibraryViewSwitcher({ initialData, initialFilter, initialSort }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = asView(params.get("view"));
  const filter = asFilter(params.get("status"));
  const sort = asSort(params.get("sort"));

  // Pin the hydration timestamp to first render via a lazy useState. Calling
  // Date.now() inline each render would feed TanStack a fresh number on every
  // render, which can defeat the staleTime check and trigger a redundant
  // refetch after hydration. The lazy initializer runs exactly once.
  const [initialUpdatedAt] = useState(() => Date.now());

  const { data: items = initialData } = useQuery({
    queryKey: ["library", filter, sort],
    queryFn: () => getUserLibrary({ status: filter, sort }),
    initialData: filter === initialFilter && sort === initialSort ? initialData : undefined,
    // Tell TanStack the server-rendered initialData is fresh so the 30s staleTime
    // from app/providers.tsx prevents a redundant post-hydration refetch.
    initialDataUpdatedAt: initialUpdatedAt,
  });

  function setView(v: View) {
    const next = new URLSearchParams(params);
    if (v === "shelf") next.delete("view");
    else next.set("view", v);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips />
        <div className="flex items-center gap-3">
          <SortDropdown />
          <div
            className="flex border border-[var(--border)] rounded-md overflow-hidden"
            role="group"
            aria-label="View toggle"
          >
            {VALID_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                aria-label={`${v} view`}
                className={cn(
                  "px-3 py-1.5 text-xs uppercase tracking-wide",
                  view === v
                    ? "bg-[var(--bg-card)] text-[var(--text)]"
                    : "text-[var(--text-faint)] hover:text-[var(--text-dim)]",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "shelf" ? (
        <ShelfFrame>
          <LibraryShelf items={items} filter={filter} />
        </ShelfFrame>
      ) : view === "list" ? (
        <LibraryList items={items} filter={filter} />
      ) : (
        <StatusStacks items={items} />
      )}
    </div>
  );
}
