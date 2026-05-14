"use client";

import { memo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartFull } from "@/components/pixel";
import { PosterStatusMenu } from "./poster-status-menu";

export const LibraryPoster = memo(function LibraryPoster({
  item,
  priority = false,
}: {
  item: LibraryItem;
  priority?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <motion.div
      layout
      layoutId={`poster-${item.logId}`}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="lib-item-cv group relative aspect-[2/3] w-full overflow-hidden rounded-md bg-[var(--bg-elev)] border border-[var(--border-soft)] hover:border-[var(--accent-soft)] transition-colors"
    >
      <Link href={`/games/${item.game.slug}`} className="block w-full h-full">
        {/* Portrait (2:3) box art preferred — falls back to RAWG landscape hero
            on long-tail titles where Steam CDN + SGDB both missed. */}
        {(item.game.posterUrl ?? item.game.coverUrl) ? (
          <Image
            src={(item.game.posterUrl ?? item.game.coverUrl)!}
            alt={item.game.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 140px"
            className="object-cover"
            priority={priority}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-[var(--text-faint)] p-2 text-center">
            {item.game.title}
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 gap-1">
          <p className="text-xs font-semibold text-white truncate">{item.game.title}</p>
          <div className="flex items-center justify-between">
            <StatusBadge status={item.status} size="sm" iconOnly />
            {item.rating != null && (
              <span className="flex items-center gap-1 text-xs font-mono text-white">
                <HeartFull size={10} />
                {item.rating}
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* Status menu — sibling of <Link>, above it via z-index. Radix
          DropdownMenu wires Esc + outside-click + focus restore for free. */}
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className="absolute top-1.5 right-1.5 z-20 w-6 h-6 rounded-md bg-black/60 backdrop-blur flex items-center justify-center text-white opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="Change status"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <circle cx="6" cy="2" r="1" fill="currentColor" />
              <circle cx="6" cy="6" r="1" fill="currentColor" />
              <circle cx="6" cy="10" r="1" fill="currentColor" />
            </svg>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-30 bg-[var(--bg-card)] border border-[var(--border)] rounded-md shadow-[var(--shadow-elev)] py-1 min-w-[140px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          >
            <PosterStatusMenu
              logId={item.logId}
              currentStatus={item.status}
              onSelected={() => setMenuOpen(false)}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </motion.div>
  );
});
