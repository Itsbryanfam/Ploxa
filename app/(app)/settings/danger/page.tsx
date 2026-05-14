import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { userHasPassword } from "@/lib/auth/user-has-password";
import { getProfileByUserId } from "@/lib/profile/server-actions";
import { ExportDataButton } from "./_components/export-data-button";
import { DeleteAccountFlow } from "./_components/delete-account-flow";

export default async function DangerPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/settings/danger");

  const [hasPassword, profile] = await Promise.all([
    userHasPassword(user.id),
    getProfileByUserId(user.id),
  ]);
  if (!profile) redirect("/login");

  return (
    <div className="flex flex-col gap-12">
      <section>
        <h2 className="text-lg font-medium">Export your data</h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Download a JSON archive of your profile, library, reviews, lists,
          and comments.
        </p>
        <div className="mt-4">
          <ExportDataButton />
        </div>
      </section>

      <hr className="border-[var(--border)]" />

      <section>
        <h2 className="text-lg font-medium text-[var(--danger)]">
          Delete your account
        </h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Your account will be marked deleted immediately. You have 30 days to
          sign back in and cancel before everything is permanently removed.
        </p>
        <div className="mt-4">
          <DeleteAccountFlow hasPassword={hasPassword} username={profile.username} />
        </div>
      </section>
    </div>
  );
}
