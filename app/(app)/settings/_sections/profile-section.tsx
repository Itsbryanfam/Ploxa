"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AvatarUploader } from "@/components/settings/avatar-uploader";
import { uploadAvatar } from "@/lib/profile/avatar-actions";
import type { HeaderUser } from "@/lib/profile/server-actions";

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
