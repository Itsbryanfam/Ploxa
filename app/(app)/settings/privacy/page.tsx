import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getProfileByUserId } from "@/lib/profile/server-actions";
import { getBlocked } from "@/lib/social/blocks/server-actions";
import { VisibilityToggle } from "./visibility-toggle";
import { BlockedList } from "./blocked-list";

export const metadata = { title: "Privacy — Settings" };

export default async function PrivacyPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/settings/privacy");

  const [profile, blocked] = await Promise.all([
    getProfileByUserId(user.id),
    getBlocked(),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-xl font-semibold">Profile visibility</h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Private hides your library, reviews, and lists from anyone who
          doesn&apos;t already follow you. People who already follow you keep
          their access.
        </p>
        <div className="mt-4">
          <VisibilityToggle initial={profile?.isPublic ?? true} />
        </div>
      </section>

      <section id="blocked">
        <h2 className="text-xl font-semibold">Blocked users</h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Blocked users can&apos;t see your content, and you won&apos;t see
          theirs.
        </p>
        <div className="mt-4">
          <BlockedList initial={blocked} />
        </div>
      </section>
    </div>
  );
}
