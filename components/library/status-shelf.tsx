"use client";

import Link from "next/link";
import Image from "next/image";
import type { LibraryItem } from "@/lib/logs/server-actions";
import { STATUS_ICONS } from "@/components/pixel";
import type { LogStatus } from "@/lib/db/schema-types";
import { HeartFull } from "@/components/pixel";

const SHELF_ORDER: { status: LogStatus; label: string }[] = [
  { status: "playing", label: "Playing" },
  { status: "backlog", label: "Up Next" },
  { status: "completed", label: "Recently Completed" },
  { status: "wishlist", label: "Wishlist" },
];

export function StatusShelf({ items }: { items: LibraryItem[] }) {
  // Items arrive pre-sorted from getUserLibrary; slice top 12 per bucket.
  const byStatus: Record<LogStatus, LibraryItem[]> = {
    backlog: [], playing: [], completed: [], dropped: [], on_hold: [], wishlist: [],
  };
  for (const item of items) {
    byStatus[item.status]?.push(item);
  }
  for (const s of Object.keys(byStatus) as LogStatus[]) {
    byStatus[s] = byStatus[s].slice(0, 12);
  }

  return (
    <div className="space-y-8">
      {SHELF_ORDER.map(({ status, label }) => {
        const Icon = STATUS_ICONS[status];
        const shelfItems = byStatus[status];
        return (
          <section key={status}>
            <header className="flex items-center gap-2 mb-3 px-1">
              <Icon size={16} />
              <h2 className="text-sm font-semibold text-[var(--text)]">{label}</h2>
              {shelfItems.length > 0 && (
                <span className="text-xs text-[var(--text-faint)]">{shelfItems.length}</span>
              )}
            </header>
            {shelfItems.length === 0 ? (
              <p className="text-xs text-[var(--text-faint)] px-1">— Nothing here yet.</p>
            ) : (
              <div
                className="flex gap-3 overflow-x-auto pb-2"
                style={{ scrollSnapType: "x mandatory" }}
              >
                {shelfItems.map((item) => (
                  <ShelfItem key={item.logId} item={item} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ShelfItem({ item }: { item: LibraryItem }) {
  return (
    <Link
      href={`/games/${item.game.slug}`}
      className="flex-shrink-0 w-[140px] group"
      style={{ scrollSnapAlign: "start" }}
    >
      <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-[var(--bg-elev)] border border-[var(--border-soft)] group-hover:border-[var(--accent-soft)] transition-colors">
        {item.game.coverUrl && (
          <Image
            src={item.game.coverUrl}
            alt={item.game.title}
            fill
            sizes="140px"
            className="object-cover"
            unoptimized
          />
        )}
      </div>
      <div className="mt-1.5">
        <p className="text-xs text-[var(--text)] truncate">{item.game.title}</p>
        {item.rating != null && (
          <p className="text-xs text-[var(--text-faint)] flex items-center gap-1">
            <HeartFull size={8} /> {item.rating}
          </p>
        )}
      </div>
    </Link>
  );
}
