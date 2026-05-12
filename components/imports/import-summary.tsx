"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";

import { syncNow } from "@/lib/imports/server-actions";
import type { GameCoverMeta } from "@/lib/imports/summary-data";

interface StatusResponse {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  stuck: boolean;
  importedCount: number;
  totalCount: number;
  errorMessage: string | null;
  conflicts: Array<{ logId: string; gameId: number; rule: string }>;
  unmatched: Array<{ externalId: string; title: string; platform: string }>;
}

interface Props {
  importId: string;
  platform: "steam" | "xbox";
  /** Cover metadata for merged (conflict) games, pre-fetched by the page RSC. */
  mergedCovers?: GameCoverMeta[];
  /** Cover metadata for newly imported games, pre-fetched by the page RSC. */
  newCovers?: GameCoverMeta[];
}

export function ImportSummary({ importId, platform, mergedCovers = [], newCovers = [] }: Props) {
  const [showContinue, setShowContinue] = useState(false);
  const { data } = useQuery<StatusResponse>({
    queryKey: ["imports", "status", importId],
    queryFn: async () => {
      const res = await fetch(`/api/imports/${importId}/status`);
      return res.json();
    },
    refetchInterval: (q) => {
      const d = q.state.data as StatusResponse | undefined;
      if (!d) return 2000;
      if (d.stuck) return false;
      return d.status === "queued" || d.status === "running" ? 2000 : false;
    },
  });

  useEffect(() => {
    if (data?.status === "completed") {
      const t = setTimeout(() => setShowContinue(true), 5000);
      return () => clearTimeout(t);
    }
  }, [data?.status]);

  if (!data) return <div className="text-sm text-[var(--text-muted)]">Loading import…</div>;

  if (data.status === "failed" || data.stuck) {
    return (
      <div className="border border-[var(--danger)] rounded-md p-6 space-y-3">
        <h2 className="text-base font-semibold">Import paused</h2>
        <p className="text-sm text-[var(--text-muted)]">
          {data.errorMessage ?? (data.stuck ? "Looks stuck — the worker didn't pick this up." : "Something went wrong.")}
        </p>
        <form action={async () => { await syncNow(platform); }}>
          <button className="text-sm px-3 py-1.5 rounded bg-[var(--accent)] text-white">Retry now</button>
        </form>
      </div>
    );
  }

  if (data.status !== "completed") {
    const pct = data.totalCount > 0 ? Math.round((data.importedCount / data.totalCount) * 100) : 0;
    return (
      <div className="border border-[var(--border)] rounded-md p-6 space-y-4 text-center">
        <h2 className="text-base font-semibold">Importing your {platform} library</h2>
        <p className="text-sm text-[var(--text-muted)]">{data.importedCount} of {data.totalCount || "?"} games</p>
        <div className="h-1 bg-[var(--bg)] rounded overflow-hidden max-w-[280px] mx-auto">
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-[var(--text-muted)]">Hang tight, or browse around — we&apos;ll keep going either way.</p>
      </div>
    );
  }

  const newCount = data.totalCount - data.conflicts.length - data.unmatched.length;
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-base font-semibold">{platform} import complete</h2>
        <p className="text-sm text-[var(--text-muted)]">{data.totalCount} games · {data.conflicts.length} already in your library</p>
      </header>

      {data.conflicts.length > 0 && (
        <section className="border border-[var(--border)] rounded-md p-3 space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Merged with existing logs</h3>
          {mergedCovers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {mergedCovers.map((g) => (
                <Link key={g.id} href={`/games/${g.slug}`} title={g.title}>
                  {g.coverUrl ? (
                    <Image
                      src={g.coverUrl}
                      alt={g.title}
                      width={48}
                      height={72}
                      className="rounded object-cover aspect-[2/3] bg-[var(--bg-elev)]"
                    />
                  ) : (
                    <div className="w-12 h-[72px] rounded bg-[var(--bg-elev)] flex items-center justify-center text-[10px] text-[var(--text-faint)] p-1 text-center">
                      {g.title}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--text-muted)]">Your status, rating, and notes were kept. Now also marked as on {platform}.</p>
        </section>
      )}

      {newCount > 0 && (
        <section className="border border-[var(--border)] rounded-md p-3 space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{newCount} new — added as backlog</h3>
          {newCovers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {newCovers.map((g) => (
                <Link key={g.id} href={`/games/${g.slug}`} title={g.title}>
                  {g.coverUrl ? (
                    <Image
                      src={g.coverUrl}
                      alt={g.title}
                      width={48}
                      height={72}
                      className="rounded object-cover aspect-[2/3] bg-[var(--bg-elev)]"
                    />
                  ) : (
                    <div className="w-12 h-[72px] rounded bg-[var(--bg-elev)] flex items-center justify-center text-[10px] text-[var(--text-faint)] p-1 text-center">
                      {g.title}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {data.unmatched.length > 0 && (
        <section className="border border-[var(--border)] rounded-md p-3">
          <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-2">{data.unmatched.length} unmatched</h3>
          <ul className="text-xs space-y-1">
            {data.unmatched.slice(0, 20).map((u) => <li key={u.externalId}>{u.title}</li>)}
          </ul>
          <a href="#" className="text-xs text-[var(--accent)] mt-2 inline-block opacity-60 cursor-not-allowed">Help us match these → (Phase 4)</a>
        </section>
      )}

      {showContinue && (
        <Link href="/library" className="text-sm text-[var(--accent)] underline">
          Continue to library →
        </Link>
      )}
    </div>
  );
}
