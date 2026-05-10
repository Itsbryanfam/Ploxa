// PlatformKey values must match keys in components/pixel/platform-icons.tsx
// PLATFORM_ICONS lookup (currently: pc, steam, xbox, psn, switch).
export type PlatformKey = "pc" | "steam" | "xbox" | "psn" | "switch";

// RAWG platform name → our internal icon key.
// First-match wins; order matters.
const RAWG_TO_KEY: Array<[RegExp, PlatformKey]> = [
  [/^pc$/i, "pc"],
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
