import Link from "next/link";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { CommandPalette } from "@/components/palette/command-palette";
import { HeaderSearchInput } from "@/components/palette/header-search-input";
import { PaletteKeyboardShortcut } from "@/components/palette/keyboard-shortcut";
import { LogoutButton } from "./logout-button";

export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  // Pre-Supabase setup: bounce to home with a helpful path back.
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    redirect("/");
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-[var(--border-soft)] bg-[var(--bg)]/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
            <span className="font-mono text-xs tracking-[0.2em] text-[var(--pixel)]">▓ L4G ▓</span>
            <span className="hidden sm:inline text-[var(--text-dim)]">Letterboxd for Games</span>
          </Link>
          <div className="flex-1 flex justify-center">
            <HeaderSearchInput />
          </div>
          <nav className="flex items-center gap-3 text-sm whitespace-nowrap">
            <span className="hidden md:inline text-[var(--text-faint)]">{user.email}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <PaletteKeyboardShortcut />
      <main className="flex-1">{children}</main>
      <CommandPalette />
      {modal}
    </div>
  );
}
