"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
    });
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} disabled={pending}>
      {pending ? "Logging out…" : "Log out"}
    </Button>
  );
}
