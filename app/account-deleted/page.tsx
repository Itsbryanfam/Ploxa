import Link from "next/link";
import { DELETION_GRACE_MS } from "@/lib/settings/account-deletion-constants";

/**
 * Public landing page — shown after a successful soft-delete and global
 * sign-out. No auth required: the session has been invalidated, so this must
 * live OUTSIDE the (app) route group.
 */
export default async function AccountDeletedPage() {
  // Date.now() is impure; the eslint react-hooks/purity rule flags it
  // even in Server Components. Marking the page async + reading via a
  // local helper makes the impurity intentional. The page is rendered
  // per request, so the value is computed fresh every time.
  const restoreBy = new Date(
    // eslint-disable-next-line react-hooks/purity -- Server Component computed per request
    Date.now() + DELETION_GRACE_MS,
  ).toLocaleDateString();

  return (
    <main className="container mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">
        Your account is scheduled for deletion
      </h1>
      <p className="mt-4 text-[var(--text-dim)]">
        We&apos;ll permanently remove your data on or around{" "}
        <strong className="text-[var(--text)]">{restoreBy}</strong>.
      </p>
      <p className="mt-2 text-[var(--text-dim)]">
        If you change your mind, just sign in within the next 30 days and
        we&apos;ll restore everything.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-block rounded bg-[var(--accent)] px-4 py-2 text-sm text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        Sign in to cancel
      </Link>
    </main>
  );
}
