"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Image from "next/image";
import { searchGames } from "@/lib/games/server-actions";
import { useDebounced } from "@/lib/palette/use-debounced";
import { usePaletteStore } from "@/lib/palette/palette-store";
import { Mascot } from "@/components/mascot/mascot";
import { PixelSpinner } from "@/components/pixel";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { cn } from "@/lib/utils";

export function GameSearchResults({ query }: { query: string }) {
  const debouncedQuery = useDebounced(query, 250);
  const selectGame = usePaletteStore((s) => s.selectGame);

  // isLoading is only true on the very first fetch for a key; isFetching also
  // fires on background revalidations. Using isLoading keeps stale results
  // visible during cache refresh instead of flashing a full-screen spinner.
  const { data: results = [], isLoading } = useQuery({
    queryKey: ["palette-search", debouncedQuery],
    queryFn: () => searchGames(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
    staleTime: 1000 * 60 * 5,
  });

  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    // Reset cursor when results change — keeps the highlight on the first item
    // after each new query completes. This is not a logic loop; results only
    // change when a new TanStack Query response arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveIndex(0);
  }, [results]);

  // Keyboard navigation
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Skip during IME composition so confirming a CJK candidate with Enter
      // doesn't double-trigger as a result selection.
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
        if (r) selectGame({ rawgId: r.rawgId, title: r.title, coverUrl: r.coverUrl });
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [results, activeIndex, selectGame]);

  if (query.length < 2) {
    return (
      <div className="px-5 py-12 text-center">
        <Mascot size="md" mood="idle" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">Start typing to search.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-5 py-12 text-center flex flex-col items-center gap-3">
        <PixelSpinner size={24} />
        <p className="text-sm text-[var(--text-dim)]">Searching...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <Mascot size="md" mood="confused" silent />
        <p className="mt-4 text-sm text-[var(--text-dim)]">Nothing matches. Try actual spelling?</p>
      </div>
    );
  }

  return (
    <ul className="py-2">
      {results.map((r, i) => (
        <li key={r.rawgId}>
          <button
            type="button"
            onClick={() => selectGame({ rawgId: r.rawgId, title: r.title, coverUrl: r.coverUrl })}
            onMouseEnter={() => setActiveIndex(i)}
            className={cn(
              "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors",
              i === activeIndex && "bg-[var(--bg-card-hover)]",
            )}
          >
            <CoverThumb url={r.coverUrl} alt={r.title} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--text)] truncate">{r.title}</p>
              <p className="text-xs text-[var(--text-faint)] flex items-center gap-2">
                {r.year ?? "—"}
                <span className="flex gap-1">
                  {r.platforms.slice(0, 4).map((p) => (
                    <PlatformIcon key={p} name={p} size={12} />
                  ))}
                </span>
              </p>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CoverThumb({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="w-9 h-12 rounded bg-[var(--bg-elev)] border border-[var(--border-soft)] flex-shrink-0" />
    );
  }
  return (
    <div className="relative w-9 h-12 rounded overflow-hidden bg-[var(--bg-elev)] flex-shrink-0">
      <Image src={url} alt={alt} fill sizes="36px" className="object-cover" unoptimized />
    </div>
  );
}
