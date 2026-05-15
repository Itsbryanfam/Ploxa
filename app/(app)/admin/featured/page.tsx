import { notFound } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAdmin } from "@/lib/social/moderation/admin";
import { getActiveFeaturedList } from "@/lib/recaps/featured-read";
import { FeaturedCurrentPin } from "@/components/admin/featured-current-pin";
import { FeaturedPinForm } from "@/components/admin/featured-pin-form";

export const metadata = {
  title: "Admin · Featured list",
  robots: { index: false, follow: false },
};

/**
 * /admin/featured — Phase 6 T8 admin UI for pinning a list to /discover.
 *
 * Non-admins (including unauthenticated viewers) get a 404 — same shape as
 * /admin/reports. We deliberately use `notFound()` rather than
 * `unauthorized()` so the route's existence isn't leaked.
 *
 * Admin membership is sourced from `ADMIN_USER_IDS` env (see
 * lib/social/moderation/admin.ts).
 *
 * The page itself is a server component. The current-pin + pin-form blocks
 * are client islands so they can surface server-action errors via
 * `useActionState`. Both islands revalidate `/admin/featured` on success
 * (via `revalidatePath` inside the underlying actions), so the next render
 * after a pin/unpin reflects the new state.
 */
export default async function AdminFeaturedPage() {
  const user = await getCachedUser();
  if (!isAdmin(user?.id)) notFound();

  const current = await getActiveFeaturedList("discover_landing");

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Featured list</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          Pins one list to the top of /discover.
        </p>
      </header>

      <FeaturedCurrentPin pin={current} />
      <FeaturedPinForm />
    </div>
  );
}
