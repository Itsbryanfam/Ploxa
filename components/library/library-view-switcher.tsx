"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { getUserLibrary, type LibraryItem, type SortKey } from "@/lib/logs/server-actions";
import { LibraryGrid } from "./library-grid";
import { LibraryList } from "./library-list";
import { StatusShelf } from "./status-shelf";
import { ShelfFrame } from "@/components/pixel/shelf-frame";
import { FilterChips } from "./filter-chips";
import { SortDropdown } from "./sort-dropdown";
import type { LogStatus } from "@/lib/db/schema-types";
import { cn } from "@/lib/utils";

type View = "grid" | "list" | "shelf";

const VALID_VIEWS = ["grid", "list", "shelf"] as const;
const VALID_FILTERS = ["all", "backlog", "playing", "completed", "dropped", "on_hold", "wishlist"] as const;
const VALID_SORTS = ["recent", "rating-desc", "rating-asc", "title-asc", "released-desc"] as const;

function asView(s: string | null): View {
  return (VALID_VIEWS as readonly string[]).includes(s ?? "") ? (s as View) : "grid";
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

  const { data: items = initialData } = useQuery({
    queryKey: ["library", filter, sort],
    queryFn: () => getUserLibrary({ status: filter, sort }),
    initialData: filter === initialFilter && sort === initialSort ? initialData : undefined,
  });

  function setView(v: View) {
    const next = new URLSearchParams(params);
    if (v === "grid") next.delete("view");
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

      {view === "grid" ? (
        <ShelfFrame>
          <LibraryGrid items={items} filter={filter} />
        </ShelfFrame>
      ) : view === "list" ? (
        <LibraryList items={items} filter={filter} />
      ) : (
        <StatusShelf items={items} />
      )}
    </div>
  );
}
