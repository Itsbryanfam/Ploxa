import { redirect } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getProfileByUserId } from "@/lib/profile/server-actions";

export default async function MeTastePage() {
  const me = await getCachedUser();
  if (!me) redirect("/login");
  const profile = await getProfileByUserId(me.id);
  if (!profile?.username) redirect("/settings");
  redirect(`/u/${profile.username}/taste`);
}
