"use client";

import Image from "next/image";

export function ScreenshotGallery({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {urls.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 relative w-72 aspect-video rounded-md overflow-hidden bg-[var(--bg-elev)] border border-[var(--border-soft)] hover:border-[var(--accent-soft)] transition-colors"
        >
          <Image src={url} alt="Screenshot" fill sizes="288px" className="object-cover" unoptimized />
        </a>
      ))}
    </div>
  );
}
