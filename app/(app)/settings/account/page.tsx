import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import { userHasPassword } from "@/lib/auth/user-has-password";
import { ChangePasswordForm } from "./_components/change-password-form";
import { SignOutOthersButton } from "./_components/sign-out-others-button";

export default async function AccountSettingsPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/settings/account");
  const hasPassword = await userHasPassword(user.id);

  return (
    <div className="flex flex-col gap-12">
      <section>
        <h2 className="text-lg font-medium">Email</h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Current:{" "}
          <span className="text-[var(--text)]">{user.email}</span>
        </p>
        <p className="mt-2 text-xs text-[var(--text-dim)]">
          The change-email form lands in a follow-up task.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium">
          {hasPassword ? "Change password" : "Set a password"}
        </h2>
        <div className="mt-4">
          <ChangePasswordForm hasPassword={hasPassword} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Sessions</h2>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Sign out everywhere else. Useful if you logged in on a shared device
          or just want a fresh start.
        </p>
        <div className="mt-4">
          <SignOutOthersButton />
        </div>
      </section>
    </div>
  );
}
