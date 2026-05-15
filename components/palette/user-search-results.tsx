"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

import { searchUsers } from "@/lib/social/discovery/search-users";
import { useDebounced } from "@/lib/palette/use-debounced";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { Mascot } from "@/components/mascot/mascot";
import { PixelSpinner } from "@/components/pixel";
import { cn } from "@/lib/utils";

/**
 * People-search variant of the command palette results list.
 *
 * Mirrors `game-search-results.tsx`'s shape so the palette feels consistent
 * across modes: same debounce, same TanStack Query cache, same arrow-key /
 * Enter navigation, same idle / loading / empty states.
 *
 * Selecting a user navigates to `/u/<username>` and closes the palette.
 * `useRouter().push()` keeps the navigation a soft transition rather than a
 * full reload — matches the rest of the SPA-style nav.
 *
 * The `query` arrived from the parent with the `@` already stripped.
 */
export function UserSearchResults({ query }: { query: string }) {
  const debouncedQuery = useDebounced(query, 250);
  const close = usePaletteStore((s) => s.close);
  const router = useRouter();

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["palette-search-users", debouncedQuery],
    queryFn: () => searchUsers(debouncedQuery),
    enabled: debouncedQuery.length >= 1,
    staleTime: 1000 * 60 * 5,
  });

  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    // Reset highlight to first result whenever the result set changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [results]);

  // Keyboard navigation — same shape as the game-search variant.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.isComposing) return;
      if (results.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const r = results[activeIndex];
        if (r) {
          router.push(`/u/${r.username}`);
          close();
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [results, activeIndex, router, close]);

  if (query.length < 1) {
    return (
      <div className="px-5 py-12 text-center">
        <Mascot size="md" mood="idle" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">
          Type a username or display name to find people.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-5 py-12 text-center flex flex-col items-center gap-3">
        <PixelSpinner size={24} />
        <p className="text-sm text-[var(--text-dim)]">Searching…</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <Mascot size="md" mood="confused" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">
          No public profiles match that.
        </p>
      </div>
    );
  }

  return (
    <ul className="py-2">
      {results.map((r, i) => (
        <li key={r.userId}>
          <button
            type="button"
            onClick={() => {
              router.push(`/u/${r.username}`);
              close();
            }}
            onMouseEnter={() => setActiveIndex(i)}
            className={cn(
              "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors",
              i === activeIndex && "bg-[var(--bg-card-hover)]",
            )}
          >
            <Avatar
              url={r.profilePictureUrl}
              alt={r.displayName ?? r.username}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--text)] truncate">
                {r.displayName ?? r.username}
              </p>
              <p className="text-xs text-[var(--text-faint)] truncate">
                @{r.username}
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Avatar({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="w-9 h-9 rounded-full bg-[var(--bg-elev)] border border-[var(--border-soft)] flex-shrink-0" />
    );
  }
  return (
    <div className="relative w-9 h-9 rounded-full overflow-hidden bg-[var(--bg-elev)] flex-shrink-0">
      <Image src={url} alt={alt} fill sizes="36px" className="object-cover" />
    </div>
  );
}
