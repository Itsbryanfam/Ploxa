"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AvatarUploader } from "@/components/settings/avatar-uploader";
import { uploadAvatar } from "@/lib/profile/avatar-actions";
import type { HeaderUser } from "@/lib/profile/server-actions";
import { updateUsername } from "@/lib/profile/server-actions";
import { UsernameInput } from "@/components/auth/username-input";
import { Button } from "@/components/ui/button";

interface Props {
  user: HeaderUser;
}

export function ProfileSection({ user }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleResult = (blob: Blob, kind: "static" | "gif") => {
    setError(null);
    // Re-pack the blob as a File so the server action sees the intended
    // MIME and a filename. The cropper outputs JPEG; GIFs pass-through.
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
      // No setState for the avatar URL: revalidatePath('/', 'layout') in
      // the action refreshes the RSC tree, so the parent will re-render
      // ProfileSection with the new `user` prop.
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
    setUsernameDraft({ value: user.username ?? "", valid: false });
    setUsernameError(null);
  }

  return (
    <section id="profile">
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
                <Button variant="secondary" onClick={cancelUsernameEdit}>
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
          <div className="text-sm text-[var(--text-dim)] mb-1">Email</div>
          <div className="text-base">{user.email}</div>
        </div>
      </div>
    </section>
  );
}
