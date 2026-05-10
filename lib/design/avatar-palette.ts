// 8 pixel-art-friendly colors used as deterministic backgrounds for the
// initials-fallback avatar. Tuned for legibility against white initials.
export const AVATAR_PALETTE = [
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#16a34a", // green
  "#ca8a04", // amber
  "#dc2626", // red
  "#db2777", // pink
  "#2563eb", // blue
  "#65a30d", // lime
] as const;

/**
 * Stable hash → palette index. Pure function, deterministic for the same
 * userId. djb2-style; sufficient for 8-bucket distribution.
 */
export function paletteIndexFor(userId: string): number {
  let hash = 5381;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) + hash) ^ userId.charCodeAt(i);
  }
  return Math.abs(hash) % AVATAR_PALETTE.length;
}

export function avatarColorFor(userId: string): string {
  return AVATAR_PALETTE[paletteIndexFor(userId)];
}
