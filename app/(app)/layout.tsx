import Link from "next/link";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { LogoutButton } from "./logout-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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
      <header className="border-b border-[var(--border-soft)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="flex items-center gap-2 text-sm font-semibold">
            <span className="font-mono text-xs tracking-[0.2em] text-[var(--pixel)]">
              ▓ L4G ▓
            </span>
            <span className="text-[var(--text-dim)]">Letterboxd for Games</span>
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <span className="text-[var(--text-faint)]">{user.email}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
