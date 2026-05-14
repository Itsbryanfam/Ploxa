"use client";

export function ExportDataButton() {
  return (
    <a
      href="/api/settings/export"
      download
      className="inline-block self-start rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      Download my data
    </a>
  );
}
