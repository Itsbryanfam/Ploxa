"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import type { SortKey } from "@/lib/logs/server-actions";

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Recently updated",
  "rating-desc": "Highest rated",
  "rating-asc": "Lowest rated",
  "title-asc": "Title (A-Z)",
  "released-desc": "Newest released",
};

export function SortDropdown() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = (params.get("sort") ?? "recent") as SortKey;

  function setSort(s: SortKey) {
    const next = new URLSearchParams(params);
    if (s === "recent") next.delete("sort");
    else next.set("sort", s);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <select
      value={current}
      onChange={(e) => setSort(e.target.value as SortKey)}
      aria-label="Sort library by"
      className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md px-3 py-1.5 text-sm text-[var(--text-dim)] focus:border-[var(--accent-soft)] outline-none"
    >
      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
        <option key={k} value={k}>
          {SORT_LABELS[k]}
        </option>
      ))}
    </select>
  );
}
