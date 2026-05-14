import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { copy } from "@/lib/mascot/copy";
import { getCachedUser } from "@/lib/supabase/auth-cache";

/**
 * Root 404 page. Fires when no route matches the requested URL.
 *
 * Server component: we cheaply peek at the session so the "take me home"
 * CTA points at /home/feed for signed-in users (more useful than the
 * marketing landing they already passed) and at /login otherwise. The
 * existing /games/[slug]/not-found.tsx and /u/[username]/not-found.tsx
 * keep their own narrower copy and override this for those route trees.
 *
 * Auth lookup is guarded: a stray null session (Supabase env not set in
 * a preview/build context) would otherwise throw inside getCachedUser
 * and bounce to error.tsx instead of rendering the 404 we actually want.
 */
export default async function RootNotFound() {
  let homeHref = "/login";
  try {
    const user = await getCachedUser();
    if (user) homeHref = "/home/feed";
  } catch {
    // Auth lookup failed (Supabase unconfigured, network blip on Edge,
    // etc.). Fall back to the public landing — the page itself decides
    // where to redirect from there.
    homeHref = "/";
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <EmptyState
        mood="confused"
        title={copy("error.404")}
        body="Either a broken link or a fever dream. Let's get you back somewhere real."
        action={
          <Link href={homeHref}>
            <Button variant="primary" size="md">
              Take me home
            </Button>
          </Link>
        }
      />
    </div>
  );
}
