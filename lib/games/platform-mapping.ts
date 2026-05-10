// Type-only import — derives PlatformKey from the actual PLATFORM_ICONS
// keys so a new icon entry can't drift out of sync. Erased at compile time
// so this module remains free of the visual asset's runtime cost.
import type { PLATFORM_ICONS } from "@/components/pixel/platform-icons";

export type PlatformKey = keyof typeof PLATFORM_ICONS;

// RAWG platform name → our internal icon key.
// First-match wins; order matters.
//
// "PC" patterns: RAWG sometimes returns "PC", sometimes "PC (Windows)".
// Word-boundary anchor accepts both while excluding accidental hits like "NPCTW".
const RAWG_TO_KEY: Array<[RegExp, PlatformKey]> = [
  [/^pc\b/i, "pc"],
  [/^steam$/i, "steam"],
  [/xbox/i, "xbox"],
  [/playstation|^ps[345]/i, "psn"],
  [/switch|nintendo/i, "switch"],
];

export function rawgPlatformToKey(name: string): PlatformKey | null {
  for (const [pattern, key] of RAWG_TO_KEY) {
    if (pattern.test(name)) return key;
  }
  return null;
}
