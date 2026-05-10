"use client";

import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartRating } from "@/components/ui/heart-rating";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";
import type { LogStatus } from "@/lib/db/schema-types";

interface Props {
  items: LibraryItem[];
  filter: LogStatus | "all";
}

export function LibraryList({ items, filter }: Props) {
  if (items.length === 0) {
    const scenarioKey =
      filter === "all" ? "library.empty.all" : (`library.empty.${filter}` as const);
    return <EmptyState mood="pointing" title={copy(scenarioKey)} />;
  }

  return (
    <ul className="divide-y divide-[var(--border-soft)] rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)]">
      <AnimatePresence mode="popLayout">
        {items.map((item) => (
          <motion.li
            key={item.logId}
            layout
            layoutId={`list-${item.logId}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          >
            <Link
              href={`/games/${item.game.slug}`}
              className="flex items-center gap-4 p-3 hover:bg-[var(--bg-card-hover)] transition-colors"
            >
              <div className="relative w-12 h-16 rounded overflow-hidden bg-[var(--bg-elev)] flex-shrink-0">
                {item.game.coverUrl && (
                  <Image
                    src={item.game.coverUrl}
                    alt={item.game.title}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-[var(--text)] truncate">{item.game.title}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-faint)]">
                  <StatusBadge status={item.status} size="sm" />
                  {item.rating != null && <HeartRating value={item.rating} disabled size={10} />}
                  {item.finishedAt && (
                    <span>Finished {new Date(item.finishedAt).toLocaleDateString()}</span>
                  )}
                  {item.hoursPlayed != null && <span>{item.hoursPlayed}h</span>}
                </div>
              </div>
            </Link>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
