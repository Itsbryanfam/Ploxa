"use client";

import { Fragment, useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import Link from "next/link";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { LibraryPoster } from "./library-poster";
import { EmptyState } from "@/components/ui/empty-state";
import { ShelfPlank } from "@/components/pixel/shelf-frame";
import { copy } from "@/lib/mascot/copy";
import { shelfVisibleCount } from "@/lib/library/shelf-rows";
import type { LogStatus } from "@/lib/db/schema-types";

interface Props {
  items: LibraryItem[];
  filter: LogStatus | "all";
  /**
   * Render only whole rows, capped at this many — for the profile shelf
   * *preview* so its decorative planks never end ragged. Omitted on the
   * full-library callsites, which must render the entire collection.
   */
  maxRows?: number;
}

/**
 * Column count per viewport width. Tuned to roughly match the previous
 * auto-fill `repeat(auto-fill, minmax(120px, 1fr))` behavior so posters
 * stay near their old size at each Tailwind breakpoint. We chunk
 * manually instead of relying on auto-fill so we can interleave
 * shelf-plank dividers between rows — auto-fill provides no row
 * boundaries the JSX layer can hook into.
 */
const COLS_AT_WIDTH: ReadonlyArray<{ minWidth: number; cols: number }> = [
  { minWidth: 1920, cols: 12 },
  { minWidth: 1536, cols: 10 },
  { minWidth: 1280, cols: 9 },
  { minWidth: 1024, cols: 7 },
  { minWidth: 768, cols: 6 },
  { minWidth: 640, cols: 5 },
  { minWidth: 0, cols: 3 },
];

function pickCols(width: number): number {
  return COLS_AT_WIDTH.find((b) => width >= b.minWidth)?.cols ?? 3;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function LibraryShelf({ items, filter, maxRows }: Props) {
  // SSR defaults to the desktop column count. The post-mount effect
  // re-evaluates against the actual viewport and re-renders if needed;
  // brief mobile reflow is acceptable and matches the rest of the app.
  const [cols, setCols] = useState(9);

  useEffect(() => {
    const update = () => setCols(pickCols(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (items.length === 0) {
    const scenarioKey =
      filter === "all" ? "library.empty.all" : (`library.empty.${filter}` as const);
    return (
      <EmptyState
        mood={filter === "all" ? "pointing" : "confused"}
        title={copy(scenarioKey)}
        body={filter === "all" ? "Press ⌘K to log your first game." : undefined}
        action={
          filter === "all" ? (
            <Link
              href="/settings/connections"
              className="text-xs text-[var(--text-muted)] underline"
            >
              Or connect Steam →
            </Link>
          ) : undefined
        }
      />
    );
  }

  // Trim a capped preview to whole rows so the shelf never ends on a
  // half-empty plank; uncapped callsites render every item unchanged.
  const visible = items.slice(0, shelfVisibleCount(items.length, cols, maxRows));
  const rows = chunk(visible, cols);

  return (
    <div className="flex flex-col gap-3">
      {rows.map((rowItems, rowIdx) => (
        <Fragment key={`row-${rowIdx}`}>
          {/*
            Plain <div>, not <motion.div layout>. With the chunking we added
            for shelf-plank dividers, a per-row layout-animated wrapper means
            every visible row tries to play its own layout animation
            simultaneously whenever `cols` changes (e.g. the post-mount
            useEffect bumps cols from the SSR default to the actual viewport,
            or the user switches back into shelf view) — which reads as
            jittery, "wacky" cascades during view transitions. Each
            LibraryPoster still has its own motion.div/layout for individual
            position animation during filter/sort, and AnimatePresence below
            still handles per-item exit on filter changes.
          */}
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            <AnimatePresence mode="popLayout">
              {rowItems.map((item, j) => (
                <LibraryPoster
                  key={item.logId}
                  item={item}
                  priority={rowIdx === 0 && j === 0}
                />
              ))}
            </AnimatePresence>
          </div>
          {rowIdx < rows.length - 1 && <ShelfPlank position="middle" />}
        </Fragment>
      ))}
    </div>
  );
}
