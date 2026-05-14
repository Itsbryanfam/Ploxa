import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/lib/env";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAccountSoftDeleted } from "@/lib/settings/account-deletion-actions";

import { AppHeader } from "@/components/layout/app-header";
import { CommandPaletteMount } from "@/components/palette/command-palette-mount";
import { ImportToast } from "@/components/imports/import-toast";
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
  const authUser = await getCachedUser();
  if (!authUser) {
    redirect("/login");
  }

  // Soft-delete guard: if the user is in the 30-day grace window, redirect
  // every (app) path to /cancel-deletion EXCEPT /cancel-deletion itself
  // (to avoid an infinite redirect). Middleware sets the x-pathname header
  // on every request so we can do the path check here in a Server Component.
  const deletedAt = await isAccountSoftDeleted(authUser.id);
  if (deletedAt) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (!pathname.startsWith("/cancel-deletion")) {
      redirect("/cancel-deletion");
    }
  }

  const headerUser = await getHeaderUser(authUser);

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={headerUser} searchSlot={<HeaderSearchInput />} />
      <PaletteKeyboardShortcut />
      <main className="flex-1">{children}</main>
      <CommandPaletteMount />
      {modal}
      <ImportToast />
    </div>
  );
}
