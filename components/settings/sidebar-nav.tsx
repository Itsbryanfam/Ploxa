"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECTIONS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/notifications", label: "Notifications" },
  { href: "/settings/privacy", label: "Privacy" },
  { href: "/settings/connections", label: "Connections" },
  { href: "/settings/danger", label: "Danger Zone" },
] as const;

export function SettingsSidebarNav() {
  const pathname = usePathname();
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
