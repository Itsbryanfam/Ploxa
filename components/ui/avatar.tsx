"use client";

import { useState, useId } from "react";
import { cn } from "@/lib/utils";
import { avatarColorFor } from "@/lib/design/avatar-palette";

type AvatarKind = "static" | "gif";

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
  // Intentional <img> rather than next/image because (a) the URL is Supabase
  // Storage which isn't in remotePatterns by default, (b) the rendered size
  // is 24-96px so optimization savings are negligible, and (c) keeping img
  // here parallels the GIF branch below which can't use next/image at all.
  if (user.profilePictureUrl && user.profilePictureKind === "static") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- see comment above
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
  // Although `hovered` is set on mouseenter/focus regardless of motion
  // preference, the src swap is gated on `hovered && !reducedMotion`, so
  // the animated src is never shown to users who prefer reduced motion.
  if (user.profilePictureUrl && user.profilePictureKind === "gif") {
    const hintId = `${id}-gif-hint`;
    const poster = user.profilePicturePosterUrl ?? user.profilePictureUrl;
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const src = hovered && !reducedMotion ? user.profilePictureUrl : poster;
    return (
      <>
        <span id={hintId} className="sr-only">
          Animated avatar. Hover or focus to play.
        </span>
        {/* Intentional <img>: next/image strips animated GIF frames during */}
        {/* optimization, breaking the hover-to-animate src swap. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={user.username ?? user.email}
          width={px}
          height={px}
          className={cn(
            "rounded-full object-cover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]",
            className,
          )}
          style={{ width: px, height: px }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          tabIndex={0}
          aria-describedby={hintId}
        />
      </>
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
