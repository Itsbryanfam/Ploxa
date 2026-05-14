"use client";

import { useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { AvatarUploader } from "@/components/settings/avatar-uploader";
import { uploadAvatar } from "@/lib/profile/avatar-actions";
import {
  updateDiscordUsername,
  updateDisplayName,
  updateBio,
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
  initialDisplayName?: string | null;
  initialBio?: string | null;
}

export function ProfileForm({
  user,
  discordUsername,
  initialDisplayName,
  initialBio,
}: Props) {
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
    // The user's current name is valid by definition (matches treatInitialAsValid
    // when re-opened); flagging it as valid keeps state consistent.
    setUsernameDraft({ value: user.username ?? "", valid: true });
    setUsernameError(null);
  }

  // ---------------------------------------------------------------------------
  // Display name (saves on blur)
  // ---------------------------------------------------------------------------
  const [displayNameDraft, setDisplayNameDraft] = useState(initialDisplayName ?? "");
  const [displayNameSaved, setDisplayNameSaved] = useState<string>(initialDisplayName ?? "");
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [savingDisplayName, startDisplayNameTransition] = useTransition();

  function saveDisplayNameOnBlur() {
    const next = displayNameDraft.trim();
    const current = displayNameSaved.trim();
    if (next === current) return;
    setDisplayNameError(null);
    startDisplayNameTransition(async () => {
      const res = await updateDisplayName(displayNameDraft);
      if (res.ok) {
        setDisplayNameSaved(displayNameDraft.trim());
        setDisplayNameDraft(displayNameDraft.trim());
      } else {
        setDisplayNameError(res.error);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Bio (saves on blur)
  // ---------------------------------------------------------------------------
  const [bioDraft, setBioDraft] = useState(initialBio ?? "");
  const [bioSaved, setBioSaved] = useState<string>(initialBio ?? "");
  const [bioError, setBioError] = useState<string | null>(null);
  const [savingBio, startBioTransition] = useTransition();

  function saveBioOnBlur() {
    const next = bioDraft.trim();
    const current = bioSaved.trim();
    if (next === current) return;
    setBioError(null);
    startBioTransition(async () => {
      const res = await updateBio(bioDraft);
      if (res.ok) {
        setBioSaved(bioDraft.trim());
        setBioDraft(bioDraft.trim());
      } else {
        setBioError(res.error);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Discord handle (saves on blur; null = no pill rendered on profile page)
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
        // Re-sync the input with the canonical normalized value (leading @ stripped).
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
          <label
            htmlFor="display-name"
            className="text-sm text-[var(--text-dim)] mb-1 block"
          >
            Display name{" "}
            <span className="text-xs text-[var(--text-faint)]">
              (shown instead of your username where space allows)
            </span>
          </label>
          <input
            id="display-name"
            type="text"
            inputMode="text"
            value={displayNameDraft}
            onChange={(e) => setDisplayNameDraft(e.target.value)}
            onBlur={saveDisplayNameOnBlur}
            placeholder="Your name"
            maxLength={64}
            aria-describedby="display-name-status"
            className="w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
          <p
            id="display-name-status"
            className="text-xs text-[var(--text-dim)] mt-1 h-4"
            aria-live="polite"
          >
            {savingDisplayName
              ? "Saving…"
              : displayNameError
                ? ""
                : `${displayNameDraft.length} / 64`}
          </p>
          {displayNameError && (
            <p className="text-sm text-red-500" role="alert">
              {displayNameError}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="bio"
            className="text-sm text-[var(--text-dim)] mb-1 block"
          >
            Bio{" "}
            <span className="text-xs text-[var(--text-faint)]">
              (shown on your public profile)
            </span>
          </label>
          <textarea
            id="bio"
            value={bioDraft}
            onChange={(e) => setBioDraft(e.target.value)}
            onBlur={saveBioOnBlur}
            placeholder="Tell people a bit about yourself"
            maxLength={500}
            rows={3}
            aria-describedby="bio-status"
            className="w-full max-w-xs rounded border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm focus:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
          />
          <p
            id="bio-status"
            className="text-xs text-[var(--text-dim)] mt-1 h-4"
            aria-live="polite"
          >
            {savingBio
              ? "Saving…"
              : bioError
                ? ""
                : `${bioDraft.length} / 500`}
          </p>
          {bioError && (
            <p className="text-sm text-red-500" role="alert">
              {bioError}
            </p>
          )}
        </div>
        <div>
          <label
            htmlFor="discord-username"
            className="text-sm text-[var(--text-dim)] mb-1 block"
          >
            Discord{" "}
            <span className="text-xs text-[var(--text-faint)]">
              (shown as a copy-to-clipboard pill on your profile)
            </span>
          </label>
          <input
            id="discord-username"
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
