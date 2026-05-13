"use client";

import Link from "next/link";
import { useTransition } from "react";
import { Avatar, type AvatarUser } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/app/(auth)/login/actions";

interface Props {
  user: AvatarUser;
}

export function ProfileDropdown({ user }: Props) {
  // We invoke `logoutAction` from `onSelect` (rather than wrapping a <form>
  // in `<DropdownMenuItem asChild>`) because Radix's keyboard handler calls
  // `.click()` on the menu item's root element. With `<form>` as that root,
  // a synthetic click does NOT submit the form, so Enter/Space wouldn't
  // trigger logout for keyboard or AT users. `onSelect` fires for both
  // pointer and keyboard activation, then we kick the server action off in
  // a transition so the redirect navigation is treated as non-blocking.
  const [, startTransition] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
        <Avatar user={user} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm">Logged in as @{user.username ?? "—"}</div>
          <div className="text-xs text-[var(--text-dim)] truncate">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/me/taste">View your taste</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/blocked">Blocked users</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            startTransition(async () => {
              // Await the server action so the transition correctly tracks the
              // signOut+redirect promise. The previous `() => logoutAction()`
              // synchronously returned the promise; startTransition treated
              // the callback as complete after the first tick, before the
              // server-side redirect actually landed.
              await logoutAction();
            })
          }
        >
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
