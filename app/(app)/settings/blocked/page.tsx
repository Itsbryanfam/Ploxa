import { redirect } from "next/navigation";
import Image from "next/image";

import { getCachedUser } from "@/lib/supabase/auth-cache";
import { getBlocked, unblock } from "@/lib/social/blocks/server-actions";
import { Mascot } from "@/components/mascot/mascot";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Blocked users — Settings" };

export default async function BlockedSettingsPage() {
  const user = await getCachedUser();
  if (!user) redirect("/login?next=/settings/blocked");

  const blocked = await getBlocked();

  async function handleUnblock(formData: FormData) {
    "use server";
    const targetUserId = formData.get("targetUserId");
    if (typeof targetUserId !== "string") return;
    await unblock(targetUserId);
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Blocked users</h1>
        <p className="text-sm text-[var(--text-dim)] mt-1">
          People you&apos;ve blocked. They can&apos;t see your content and you can&apos;t see theirs.
        </p>
      </header>

      {blocked.length === 0 ? (
        <div className="text-center py-12">
          <Mascot size="lg" mood="idle" silent />
          <p className="mt-4 text-sm text-[var(--text-dim)]">You haven&apos;t blocked anyone.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {blocked.map((b) => (
            <li
              key={b.userId}
              className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)]"
            >
              <div className="flex items-center gap-3 min-w-0">
                {b.avatarUrl ? (
                  <Image
                    src={b.avatarUrl}
                    alt=""
                    width={40}
                    height={40}
                    className="rounded-full"
                    unoptimized
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--bg-card)]" />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {b.displayName ?? b.username}
                  </p>
                  <p className="text-xs text-[var(--text-dim)]">
                    @{b.username} · Blocked {relativeTime(b.blockedAt)}
                  </p>
                </div>
              </div>
              <form action={handleUnblock}>
                <input type="hidden" name="targetUserId" value={b.userId} />
                <button
                  type="submit"
                  className="px-3 py-1.5 text-sm rounded-md border border-[var(--border)] hover:border-[var(--border-hover)]"
                >
                  Unblock
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
