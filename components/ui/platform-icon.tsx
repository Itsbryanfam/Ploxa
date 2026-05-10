import { PLATFORM_ICONS } from "@/components/pixel";
import { rawgPlatformToKey } from "@/lib/games/platform-mapping";

interface PlatformIconProps {
  name: string;
  size?: number;
}

export function PlatformIcon({ name, size = 16 }: PlatformIconProps) {
  const key = rawgPlatformToKey(name);
  if (!key) return null;
  const Icon = PLATFORM_ICONS[key];
  return (
    <span
      title={name}
      role="img"
      aria-label={name}
      className="inline-flex leading-none"
      style={{ width: size, height: size }}
    >
      <Icon size={size} />
    </span>
  );
}
