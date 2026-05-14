import { headers } from "next/headers";
import Link from "next/link";

const SECTIONS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/privacy", label: "Privacy" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/danger", label: "Danger Zone" },
] as const;

/**
 * Settings left-rail nav. Server component — reads pathname from the
 * `x-pathname` request header that middleware sets (see
 * lib/supabase/middleware.ts). Avoids shipping the whole sidebar as a
 * client island just for active-row styling.
 */
export async function SettingsSidebarNav() {
  const pathname = (await headers()).get("x-pathname") ?? "";
  return (
    <nav className="flex flex-col gap-1 text-sm" aria-label="Settings navigation">
      {SECTIONS.map((s) => {
        const active = pathname === s.href || pathname.startsWith(s.href + "/");
        return (
          <Link
            key={s.href}
            href={s.href}
            className={
              active
                ? "px-3 py-2 rounded bg-[var(--bg-card)] font-medium text-[var(--text)]"
                : "px-3 py-2 rounded hover:bg-[var(--bg-card)] text-[var(--text-dim)]"
            }
            aria-current={active ? "page" : undefined}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
