import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AppHeader } from "@/components/layout/app-header";
import { CommandPalette } from "@/components/palette/command-palette";
import { HeaderSearchInput } from "@/components/palette/header-search-input";
import { PaletteKeyboardShortcut } from "@/components/palette/keyboard-shortcut";
import { getHeaderUser } from "@/lib/profile/server-actions";

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

  // Single auth check: we own the redirect path, then pass the verified user
  // into getHeaderUser so the profile lookup doesn't re-verify the session.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    redirect("/login");
  }

  const headerUser = await getHeaderUser(authUser);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={headerUser} searchSlot={<HeaderSearchInput />} />
      <PaletteKeyboardShortcut />
      <main className="flex-1">{children}</main>
      <CommandPalette />
      {modal}
    </div>
  );
}
