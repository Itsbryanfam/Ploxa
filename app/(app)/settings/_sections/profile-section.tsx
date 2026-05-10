import { Avatar } from "@/components/ui/avatar";
import type { HeaderUser } from "@/lib/profile/server-actions";

interface Props {
  user: HeaderUser;
}

export function ProfileSection({ user }: Props) {
  return (
    <section id="profile">
      <h2 className="text-xl font-semibold mb-6">Profile</h2>
      <div className="space-y-6">
        <div>
          <div className="text-sm text-[var(--text-dim)] mb-2">Profile picture</div>
          <button
            type="button"
            disabled
            className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed"
            aria-label="Change profile picture (not yet enabled)"
          >
            <Avatar user={user} size="lg" />
          </button>
          <p className="text-xs text-[var(--text-dim)] mt-2">
            Click to upload (coming in next task)
          </p>
        </div>
        <div>
          <div className="text-sm text-[var(--text-dim)] mb-1">Username</div>
          <div className="text-base">@{user.username ?? "—"}</div>
          <p className="text-xs text-[var(--text-dim)] mt-1">
            Editing lands in a later task.
          </p>
        </div>
        <div>
          <div className="text-sm text-[var(--text-dim)] mb-1">Email</div>
          <div className="text-base">{user.email}</div>
        </div>
      </div>
    </section>
  );
}
