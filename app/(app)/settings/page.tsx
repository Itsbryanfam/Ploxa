import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getHeaderUser } from "@/lib/profile/server-actions";
import { ProfileSection } from "./_sections/profile-section";
import { ConnectionsSection } from "./_sections/connections-section";

export default async function SettingsPage() {
  const authUser = await getCachedUser();
  if (!authUser) {
    redirect("/login");
  }
  const user = await getHeaderUser(authUser);

  // Pull discord_username separately — it's only edited from this page, so
  // there's no reason to bloat getHeaderUser (which feeds the AppHeader on
  // every authenticated render) with a field nothing else reads.
  const profileExtras = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, authUser.id),
    columns: { discordUsername: true },
  });

  return (
    <div className="container mx-auto px-4 py-8 grid grid-cols-12 gap-8">
      <aside className="col-span-12 md:col-span-3">
        <h1 className="text-2xl font-semibold mb-6">Settings</h1>
        <nav className="flex flex-col gap-1 text-sm">
          <a
            href="#profile"
            className="px-3 py-2 rounded bg-[var(--bg-card)]"
          >
            Profile
          </a>
          <a href="#connections" className="px-3 py-2 rounded hover:bg-[var(--bg-card)]">
            Connections
          </a>
          {/* Future sections (Account, Privacy, Notifications) added when needed. */}
        </nav>
      </aside>
      <div className="col-span-12 md:col-span-9 space-y-10">
        <ProfileSection
          user={user}
          discordUsername={profileExtras?.discordUsername ?? null}
        />
        <ConnectionsSection />
      </div>
    </div>
  );
}
