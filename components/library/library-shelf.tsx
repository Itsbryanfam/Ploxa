"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { LibraryPoster } from "./library-poster";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";
import type { LogStatus } from "@/lib/db/schema-types";

interface Props {
  items: LibraryItem[];
  filter: LogStatus | "all";
}

export function LibraryShelf({ items, filter }: Props) {
  if (items.length === 0) {
    const scenarioKey =
      filter === "all" ? "library.empty.all" : (`library.empty.${filter}` as const);
    return (
      <EmptyState
        mood={filter === "all" ? "pointing" : "confused"}
        title={copy(scenarioKey)}
        body={filter === "all" ? "Press ⌘K to log your first game." : undefined}
      />
    );
  }

  return (
    <motion.div
      layout
      className="grid gap-3"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
      }}
    >
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <LibraryPoster key={item.logId} item={item} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
