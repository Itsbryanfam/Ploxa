"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AvatarUploader } from "@/components/settings/avatar-uploader";
import { uploadAvatar } from "@/lib/profile/avatar-actions";
import {
  updateDiscordUsername,
  updateUsername,
  type HeaderUser,
} from "@/lib/profile/server-actions";
import { UsernameInput } from "@/components/auth/username-input";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// ProfileForm — interactive client island for /settings/profile
// Receives server-fetched data via props; all mutations go through Server
// Actions (uploadAvatar, updateUsername, updateDiscordUsername).
// ---------------------------------------------------------------------------

interface Props {
  user: HeaderUser;
  discordUsername: string | null;
}

export function ProfileForm({ user, discordUsername }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleResult = (blob: Blob, kind: "static" | "gif") => {
    setError(null);
    const filename = kind === "gif" ? "avatar.gif" : "avatar.jpg";
    const mime = kind === "gif" ? "image/gif" : "image/jpeg";
    const file = new File([blob], filename, { type: mime });
    const fd = new FormData();
    fd.append("file", file);
    startTransition(async () => {
      const res = await uploadAvatar(fd);
      if (!res.ok) {
        setError(res.error);
      }
    });
  };

  // ---------------------------------------------------------------------------
  // Username editing state
  // ---------------------------------------------------------------------------
  const [editingUsername, setEditingUsername] = useState(false);
  const [pendingUsername, startUsernameTransition] = useTransition();
  const [usernameDraft, setUsernameDraft] = useState({
    value: user.username ?? "",
    valid: false,
  });
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const isUsernameUnchanged = usernameDraft.value === (user.username ?? "");
  const canSaveUsername =
    usernameDraft.valid && !isUsernameUnchanged && !pendingUsername;

  function saveUsername() {
    setUsernameError(null);
    startUsernameTransition(async () => {
      const res = await updateUsername(usernameDraft.value);
      if (res.ok) {
        setEditingUsername(false);
      } else {
        setUsernameError(res.error);
      }
    });
  }

  function cancelUsernameEdit() {
    setEditingUsername(false);
    setUsernameDraft({ value: user.username ?? "", valid: true });
    setUsernameError(null);
  }

  // ---------------------------------------------------------------------------
  // Discord handle (saves on blur)
  // ---------------------------------------------------------------------------
  const [discordDraft, setDiscordDraft] = useState(discordUsername ?? "");
  const [discordSaved, setDiscordSaved] = useState<string | null>(discordUsername);
  const [discordError, setDiscordError] = useState<string | null>(null);
  const [savingDiscord, startDiscordTransition] = useTransition();

  function saveDiscordOnBlur() {
    const next = discordDraft.trim().replace(/^@/, "");
    const current = discordSaved ?? "";
    if (next === current) return;
    setDiscordError(null);
    startDiscordTransition(async () => {
      const res = await updateDiscordUsername(discordDraft);
      if (res.ok) {
        setDiscordSaved(res.discordUsername);
        setDiscordDraft(res.discordUsername ?? "");
      } else {
        setDiscordError(res.error);
      }
    });
  }

  return (
    <section>
      <h2 className="text-xl font-semibold mb-6">Profile</h2>
      <div className="space-y-6">
        <div>
          <div className="text-sm text-[var(--text-dim)] mb-2">Profile picture</div>
          <AvatarUploader onResult={handleResult}>
            <Avatar user={user} size="lg" />
          </AvatarUploader>
          <p className="text-xs text-[var(--text-dim)] mt-2">
            JPG, PNG, WebP, or GIF — up to 5 MB.
            <span aria-live="polite" className="ml-1">
              {pending ? "Uploading…" : ""}
            </span>
          </p>
          {error && (
            <p className="text-sm text-red-500 mt-2" role="alert">
              {error}
            </p>
          )}
        </div>
        <div>
          <div className="text-sm text-[var(--text-dim)] mb-1">Username</div>
          {!editingUsername ? (
            <div className="flex items-center gap-3">
              <span className="text-base">@{user.username ?? "—"}</span>
              <button
                type="button"
                onClick={() => setEditingUsername(true)}
                className="text-sm text-[var(--text-dim)] hover:text-[var(--text)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] rounded"
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <UsernameInput
                initialValue={user.username ?? ""}
                treatInitialAsValid
                onChange={(value, valid) =>
                  setUsernameDraft({ value, valid })
                }
              />
              <div className="flex items-center gap-2">
                <Button onClick={saveUsername} disabled={!canSaveUsername}>
                  {pendingUsername ? "Saving…" : "Save"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={cancelUsernameEdit}
                  disabled={pendingUsername}
                >
                  Cancel
                </Button>
              </div>
              {usernameError && (
                <p className="text-sm text-red-500" role="alert">
                  {usernameError}
                </p>
              )}
            </div>
          )}
        </div>
        <div>
          <div className="text-sm text-[var(--text-dim)] mb-1">
            Discord{" "}
            <span className="text-xs text-[var(--text-faint)]">
              (shown as a copy-to-clipboard pill on your profile)
            </span>
          </div>
          <input
            type="text"
            inputMode="text"
            value={discordDraft}
            onChange={(e) => setDiscordDraft(e.target.value)}
            onBlur={saveDiscordOnBlur}
            placeholder="username"
            maxLength={32}
            className="w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
          <p className="text-xs text-[var(--text-dim)] mt-1 h-4" aria-live="polite">
            {savingDiscord
              ? "Saving…"
              : discordError
                ? ""
                : discordSaved
                  ? `Saved as ${discordSaved}`
                  : ""}
          </p>
          {discordError && (
            <p className="text-sm text-red-500" role="alert">
              {discordError}
            </p>
          )}
        </div>
        <div>
          <div className="text-sm text-[var(--text-dim)] mb-1">Email</div>
          <div className="text-base">{user.email}</div>
        </div>
      </div>
    </section>
  );
}
