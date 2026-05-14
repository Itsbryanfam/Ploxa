import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { db, schema } from "@/lib/db";
import { NotificationPrefsForm } from "./prefs-form";

export default async function NotificationsSettingsPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/settings/notifications");

  const profile = await db.query.profiles.findFirst({
    where: eq(schema.profiles.userId, user.id),
    columns: {
      emailDigestCadence: true,
      emailFollows: true,
      emailReactions: true,
      emailComments: true,
      emailWishlist: true,
    },
  });
  if (!profile) redirect("/login");

  return (
    <div className="flex flex-col gap-8">
      <h2 className="text-lg font-medium">Notifications</h2>
      <NotificationPrefsForm initial={profile} />
    </div>
  );
}
