import { headers } from "next/headers";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Tab {
  label: string;
  href: string;
  match: (pathname: string) => boolean;
}

/**
 * Active-tab nav for the AppHeader. Server component — reads the current
 * pathname from the `x-pathname` request header that middleware sets on
 * every (app)/* request (see lib/supabase/middleware.ts). Avoids forcing
 * the whole header into a client island just for active-tab styling.
 *
 * If the header isn't set (e.g. a request slipped past middleware), the
 * fallback is empty-string — every tab renders inactive, which is the
 * safe degradation for navigation chrome.
 */
export async function NavTabs({ profileHref }: { profileHref: string }) {
  const pathname = (await headers()).get("x-pathname") ?? "";
  const tabs: Tab[] = [
    { label: "Home", href: "/home", match: (p) => p === "/home" || p === "/dashboard" },
    { label: "Feed", href: "/home/feed", match: (p) => p.startsWith("/home/feed") },
    { label: "Discover", href: "/discover", match: (p) => p.startsWith("/discover") },
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
