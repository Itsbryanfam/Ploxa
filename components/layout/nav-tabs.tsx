"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Tab {
  label: string;
  href: string;
  match: (pathname: string) => boolean;
}

export function NavTabs({ profileHref }: { profileHref: string }) {
  const pathname = usePathname();
  const tabs: Tab[] = [
    { label: "Home", href: "/home", match: (p) => p === "/home" || p === "/dashboard" },
    { label: "Library", href: "/library", match: (p) => p.startsWith("/library") },
    { label: "Profile", href: profileHref, match: (p) => p.startsWith("/u/") },
  ];
  return (
    <nav className="flex items-center gap-6 text-sm">
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "py-2 border-b-2 transition-colors",
              active
                ? "border-[var(--accent)] text-[var(--text)]"
                : "border-transparent text-[var(--text-dim)] hover:text-[var(--text)]",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
