"use client";

import { useState, useId } from "react";
import { cn } from "@/lib/utils";
import { avatarColorFor } from "@/lib/design/avatar-palette";

export type AvatarKind = "static" | "gif";

export interface AvatarUser {
  id: string;
  username: string | null;
  email: string;
  profilePictureUrl: string | null;
  profilePictureKind: AvatarKind | null;
  /**
   * Optional: URL to the server-extracted first-frame poster for GIFs.
   * Required when `profilePictureKind === 'gif'`. Conventionally hosted at
   * `<userId>/avatar-poster.png` in the `avatars` Supabase Storage bucket.
   */
  profilePicturePosterUrl?: string | null;
}

const SIZES = {
  sm: 24,
  md: 40,
  lg: 96,
} as const;

interface AvatarProps {
  user: AvatarUser;
  size: keyof typeof SIZES;
  className?: string;
}

export function Avatar({ user, size, className }: AvatarProps) {
  const px = SIZES[size];
  const [hovered, setHovered] = useState(false);
  const id = useId();

  // Static image (jpg/png/webp): plain <img>.
  if (user.profilePictureUrl && user.profilePictureKind === "static") {
    return (
      <img
        src={user.profilePictureUrl}
        alt={user.username ?? user.email}
        width={px}
        height={px}
        className={cn("rounded-full object-cover", className)}
        style={{ width: px, height: px }}
      />
    );
  }

  // GIF: poster on rest, animated on hover/focus.
  // `prefers-reduced-motion: reduce` users always see the poster (the swap
  // is gated on the `hovered` state, which we never set true under reduced
  // motion — see the matchMedia check).
  if (user.profilePictureUrl && user.profilePictureKind === "gif") {
    const poster = user.profilePicturePosterUrl ?? user.profilePictureUrl;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const src = hovered && !reducedMotion ? user.profilePictureUrl : poster;
    return (
      <img
        src={src}
        alt={user.username ?? user.email}
        width={px}
        height={px}
        className={cn("rounded-full object-cover", className)}
        style={{ width: px, height: px }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        tabIndex={0}
        aria-describedby={`${id}-gif-hint`}
      />
    );
  }

  // Initials fallback: 1 character in a colored circle.
  const initial = (user.username ?? user.email).charAt(0).toUpperCase();
  const bg = avatarColorFor(user.id);
  return (
    <div
      role="img"
      aria-label={user.username ?? user.email}
      className={cn(
        "rounded-full flex items-center justify-center text-white font-medium select-none",
        className,
      )}
      style={{
        width: px,
        height: px,
        backgroundColor: bg,
        fontSize: Math.round(px * 0.5),
      }}
    >
      {initial}
    </div>
  );
}
