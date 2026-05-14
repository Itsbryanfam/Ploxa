"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import type { AvatarUser } from "@/components/ui/avatar";
import { logoutAction } from "@/app/(auth)/login/actions";

interface Props {
  user: AvatarUser;
  profileHref: string;
}

export function MobileMenu({ user, profileHref }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className="md:hidden p-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
        <Menu size={20} />
        <span className="sr-only">Open navigation menu</span>
      </SheetTrigger>
      <SheetContent side="right" className="w-72">
        <SheetHeader>
          <SheetTitle>Menu</SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 mt-6">
          {[
            { label: "Home", href: "/home" },
            { label: "Feed", href: "/home/feed" },
            { label: "What to play", href: "/play-next" },
            { label: "Notifications", href: "/notifications" },
            { label: "Discover", href: "/discover" },
            { label: "Library", href: "/library" },
            { label: "Profile", href: profileHref },
            { label: "Settings", href: "/settings" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded hover:bg-[var(--bg-card)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6 pt-6 border-t border-[var(--border-soft)] text-sm">
          <div>@{user.username ?? "—"}</div>
          <div className="text-[var(--text-dim)] truncate">{user.email}</div>
        </div>
        <form action={logoutAction} className="mt-4">
          <button type="submit" className="w-full text-left px-3 py-2 rounded hover:bg-[var(--bg-card)]">
            Log out
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
