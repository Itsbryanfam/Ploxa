"use client";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { markImportsSurfaced } from "@/lib/imports/server-actions";

interface ImportRow {
  id: string;
  platform: "steam" | "xbox";
  status: "queued" | "running" | "completed" | "failed";
  importedCount: number;
  totalCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface LatestResponse {
  active: ImportRow | null;
  recentSuccess: ImportRow | null;
  delta: ImportRow[];
}

export function ImportToast() {
  const { data } = useQuery<LatestResponse>({
    queryKey: ["imports", "latest"],
    queryFn: async () => {
      const res = await fetch("/api/imports/latest");
      return res.json() as Promise<LatestResponse>;
    },
    refetchInterval: (q) => {
      const d = q.state.data as LatestResponse | undefined;
      return d?.active && d.active.status !== "failed" ? 2000 : false;
    },
    // Cross-page nav reuses the cached response for 2 minutes so the toast
    // mount in the app layout doesn't re-pull on every navigation. During
    // an active import the 2s refetchInterval overrides this anyway.
    staleTime: 120_000,
    gcTime: 120_000,
  });

  // Surface deltas exactly once on mount; use join(",") so the effect dep
  // compares by content rather than array identity.
  const deltaIds = useMemo(() => (data?.delta ?? []).map((r) => r.id), [data?.delta]);
  useEffect(() => {
    if (deltaIds.length > 0) {
      // Fire-and-forget: toast renders immediately; flip surfaced=true so
      // the next poll won't re-surface the same rows.
      void markImportsSurfaced(deltaIds);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deltaIds.join(",")]);

  if (!data) return null;

  // Priority order: error > importing > recentSuccess > delta

  // --- Error state ---
  if (data.active?.status === "failed") {
    return (
      <Link
        href="/settings#connections"
        className="fixed bottom-3 right-3 z-50 flex w-[280px] items-center gap-2 rounded-lg border border-[var(--danger)] bg-[var(--bg-card)] px-4 py-2 text-xs shadow-lg"
      >
        <span className="h-3.5 w-3.5 flex-shrink-0 rounded bg-[var(--danger)]" aria-hidden />
        <span>{data.active.platform} sync paused — see Settings</span>
      </Link>
    );
  }

  // --- Importing state (queued or running) ---
  if (data.active && (data.active.status === "queued" || data.active.status === "running")) {
    const pct =
      data.active.totalCount > 0
        ? Math.round((data.active.importedCount / data.active.totalCount) * 100)
        : 0;
    return (
      <Link
        href="/settings#connections"
        className="fixed bottom-3 right-3 z-50 block w-[280px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-xs shadow-lg"
      >
        <div className="mb-1 flex items-center justify-between">
          <span>Importing {data.active.platform} library…</span>
          <span className="text-[var(--text-muted)]">
            {data.active.importedCount} / {data.active.totalCount || "?"}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded bg-[var(--bg)]">
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </Link>
    );
  }

  // --- Success state (auto-dismiss: completedAt falls out of the 60s window) ---
  if (data.recentSuccess) {
    return (
      <div className="fixed bottom-3 right-3 z-50 flex w-[280px] items-center gap-2 rounded-lg border border-[var(--success)] bg-[var(--bg-card)] px-4 py-2 text-xs shadow-lg">
        <span className="h-3.5 w-3.5 flex-shrink-0 rounded bg-[var(--success)]" aria-hidden />
        <span>
          <strong>{data.recentSuccess.platform}</strong> import complete ·{" "}
          {data.recentSuccess.importedCount} games
        </span>
      </div>
    );
  }

  // --- Delta state (unsurfaced background imports) ---
  if (data.delta.length > 0) {
    const parts = data.delta.map((r) => `+${r.importedCount} from ${r.platform}`).join(" · ");
    const earliest = data.delta.reduce(
      (min, r) =>
        r.completedAt && (!min || r.completedAt < min) ? r.completedAt : min,
      null as string | null,
    );
    return (
      <Link
        href={`/library?source=imports&since=${encodeURIComponent(earliest ?? "")}`}
        className="fixed bottom-3 right-3 z-50 flex w-[280px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-xs shadow-lg"
      >
        <span>
          {parts} since you were last here · See →
        </span>
      </Link>
    );
  }

  return null;
}
