"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { StatusBadge } from "@/components/ui/status-badge";
import { HeartFull } from "@/components/pixel";
import { PosterStatusMenu } from "./poster-status-menu";

export function LibraryPoster({ item }: { item: LibraryItem }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <motion.div
      layout
      layoutId={`poster-${item.logId}`}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="group relative aspect-[2/3] w-full overflow-hidden rounded-md bg-[var(--bg-elev)] border border-[var(--border-soft)] hover:border-[var(--accent-soft)] transition-colors"
    >
      <Link href={`/games/${item.game.slug}`} className="block w-full h-full">
        {item.game.coverUrl ? (
          <Image
            src={item.game.coverUrl}
            alt={item.game.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 140px"
            className="object-cover"
            unoptimized
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

      {/* Status menu — sibling of <Link>, above it via z-index */}
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="absolute top-1.5 right-1.5 z-20 w-6 h-6 rounded-md bg-black/60 backdrop-blur flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Change status"
        aria-expanded={menuOpen}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <circle cx="6" cy="2" r="1" fill="currentColor" />
          <circle cx="6" cy="6" r="1" fill="currentColor" />
          <circle cx="6" cy="10" r="1" fill="currentColor" />
        </svg>
      </button>
      <AnimatePresence>
        {menuOpen && (
          <PosterStatusMenu
            logId={item.logId}
            currentStatus={item.status}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
