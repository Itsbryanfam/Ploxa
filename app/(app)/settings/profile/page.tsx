import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db, schema } from "@/lib/db";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getHeaderUser } from "@/lib/profile/server-actions";
import { ProfileForm } from "./_profile-form";

export const metadata = { title: "Profile — Settings" };

export default async function ProfileSettingsPage() {
  const authUser = await getCachedUser();
  if (!authUser) {
    redirect("/login");
  }
  const user = await getHeaderUser(authUser);

  // Pull discord_username separately — it's only edited from this page.
  const profileExtras = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, authUser.id),
    columns: { discordUsername: true },
  });

  return (
    <ProfileForm
      user={user}
      discordUsername={profileExtras?.discordUsername ?? null}
    />
  );
}
