import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getHeaderUser } from "@/lib/profile/server-actions";
import { ProfileSection } from "./_sections/profile-section";

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    redirect("/login");
  }
  const user = await getHeaderUser(authUser);

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
          {/* Future sections (Account, Privacy, Notifications) added when needed. */}
        </nav>
      </aside>
      <div className="col-span-12 md:col-span-9">
        <ProfileSection user={user} />
      </div>
    </div>
  );
}
