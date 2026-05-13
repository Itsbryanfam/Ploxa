import { notFound } from "next/navigation";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { isAdmin } from "@/lib/social/moderation/admin";
import { getReportQueue } from "@/lib/social/moderation/queue";
import { ReportsQueue } from "@/components/moderation/reports-queue";

export const metadata = {
  title: "Admin · Reports",
  robots: { index: false, follow: false },
};

/**
 * /admin/reports — moderation queue.
 *
 * Non-admins (including unauthenticated viewers) get a 404. We deliberately
 * use `notFound()` rather than `unauthorized()` so the route's existence
 * isn't leaked to the public — same shape as the privacy gate elsewhere.
 *
 * Admin membership is sourced from `ADMIN_USER_IDS` env (see lib/env.ts +
 * lib/social/moderation/admin.ts). Phase 5 ships with comma-separated env
 * config; if the operator pool grows we'll migrate to a user_roles table.
 */
export default async function AdminReportsPage() {
  const user = await getCachedUser();
  if (!isAdmin(user?.id)) notFound();

  const queue = await getReportQueue();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Pending reports</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          {queue.length} {queue.length === 1 ? "report" : "reports"} awaiting review
        </p>
      </header>
      <ReportsQueue reports={queue} />
    </div>
  );
}
