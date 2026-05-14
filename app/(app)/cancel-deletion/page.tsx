import { redirect } from "next/navigation";
import { getCachedUser } from "@/lib/supabase/auth-cache";
import {
  isAccountSoftDeleted,
  cancelDeletion,
  DELETION_GRACE_MS,
} from "@/lib/settings/account-deletion-actions";

/**
 * Grace-window recovery page for soft-deleted accounts.
 *
 * Lives under (app)/ so the user sees the standard app header — they're still
 * authenticated, just soft-deleted. The (app) layout guard redirects them HERE
 * from any other (app) path; the layout allows this page through to avoid an
 * infinite redirect.
 *
 * If the user navigates here but isn't actually soft-deleted (e.g. direct URL),
 * we bounce them to /home.
 */
export default async function CancelDeletionPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const deletedAt = await isAccountSoftDeleted(user.id);
  if (!deletedAt) redirect("/home");

  async function cancel() {
    "use server";
    await cancelDeletion();
    redirect("/home");
  }

  const restoreBy = new Date(
    deletedAt.getTime() + DELETION_GRACE_MS,
  ).toLocaleDateString();

  return (
    <main className="container mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-4 text-[var(--text-dim)]">
        Your account is scheduled for deletion on{" "}
        <strong className="text-[var(--text)]">{restoreBy}</strong>.
      </p>
      <form action={cancel} className="mt-6">
        <button
          type="submit"
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Cancel deletion and restore my account
        </button>
      </form>
    </main>
  );
}
