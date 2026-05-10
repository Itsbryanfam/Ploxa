import type { SVGProps } from "react";

interface PlatformIconProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  size?: number;
}

// ─── PC ────────────────────────────────────────────────────────
// Monitor: outer frame, inner screen (dark), stand + base
export function PCIcon({ size = 16, ...rest }: PlatformIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Monitor outer frame */}
      <rect x="1" y="2" width="14" height="10" fill="#9494a8" />
      {/* Inner screen (dark) */}
      <rect x="2" y="3" width="12" height="8" fill="#1a1a24" />
      {/* Screen glow — subtle highlight row */}
      <rect x="3" y="4" width="10" height="1" fill="#7c5cff" opacity="0.6" />
      {/* Stand stem */}
      <rect x="7" y="12" width="2" height="2" fill="#9494a8" />
      {/* Stand base */}
      <rect x="4" y="14" width="8" height="1" fill="#9494a8" />
    </svg>
  );
}

// ─── Steam ─────────────────────────────────────────────────────
// Ring circle with a spiral wedge cutout (top-right quarter removed + inner dot)
// Recognizable as the Steam logo's circular form at small sizes
export function SteamIcon({ size = 16, ...rest }: PlatformIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Outer ring — pixel-circle approximation */}
      <rect x="5" y="1" width="6" height="1" fill="#9494a8" />
      <rect x="3" y="2" width="2" height="1" fill="#9494a8" />
      <rect x="11" y="2" width="2" height="1" fill="#9494a8" />
      <rect x="2" y="3" width="1" height="2" fill="#9494a8" />
      <rect x="13" y="3" width="1" height="2" fill="#9494a8" />
      <rect x="1" y="5" width="1" height="6" fill="#9494a8" />
      <rect x="14" y="5" width="1" height="6" fill="#9494a8" />
      <rect x="2" y="11" width="1" height="2" fill="#9494a8" />
      <rect x="13" y="11" width="1" height="2" fill="#9494a8" />
      <rect x="3" y="13" width="2" height="1" fill="#9494a8" />
      <rect x="11" y="13" width="2" height="1" fill="#9494a8" />
      <rect x="5" y="14" width="6" height="1" fill="#9494a8" />
      {/* Inner fill — ring body */}
      <rect x="3" y="4" width="10" height="8" fill="#9494a8" />
      <rect x="4" y="3" width="8" height="1" fill="#9494a8" />
      <rect x="4" y="12" width="8" height="1" fill="#9494a8" />
      {/* Cutout: top-right wedge (dark hole to suggest spiral) */}
      <rect x="8" y="2" width="4" height="4" fill="#1a1a24" />
      <rect x="10" y="4" width="2" height="3" fill="#1a1a24" />
      {/* Inner center circle (bright accent) */}
      <rect x="6" y="6" width="4" height="4" fill="#7c5cff" />
      <rect x="5" y="7" width="1" height="2" fill="#7c5cff" />
      <rect x="10" y="7" width="1" height="2" fill="#7c5cff" />
      <rect x="6" y="5" width="4" height="1" fill="#7c5cff" />
      <rect x="6" y="10" width="4" height="1" fill="#7c5cff" />
    </svg>
  );
}

// ─── Xbox ──────────────────────────────────────────────────────
// Circle ring with an X through it (Xbox green)
export function XboxIcon({ size = 16, ...rest }: PlatformIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Circle ring */}
      <rect x="5" y="1" width="6" height="1" fill="#4ade80" />
      <rect x="3" y="2" width="2" height="1" fill="#4ade80" />
      <rect x="11" y="2" width="2" height="1" fill="#4ade80" />
      <rect x="2" y="3" width="1" height="2" fill="#4ade80" />
      <rect x="13" y="3" width="1" height="2" fill="#4ade80" />
      <rect x="1" y="5" width="1" height="6" fill="#4ade80" />
      <rect x="14" y="5" width="1" height="6" fill="#4ade80" />
      <rect x="2" y="11" width="1" height="2" fill="#4ade80" />
      <rect x="13" y="11" width="1" height="2" fill="#4ade80" />
      <rect x="3" y="13" width="2" height="1" fill="#4ade80" />
      <rect x="11" y="13" width="2" height="1" fill="#4ade80" />
      <rect x="5" y="14" width="6" height="1" fill="#4ade80" />
      {/* X — diagonal bars (two pixels wide each arm) */}
      <rect x="4" y="4" width="2" height="2" fill="#4ade80" />
      <rect x="6" y="6" width="2" height="2" fill="#4ade80" />
      <rect x="8" y="8" width="2" height="2" fill="#4ade80" /> {/* center overlap */}
      <rect x="10" y="10" width="2" height="2" fill="#4ade80" />
      <rect x="10" y="4" width="2" height="2" fill="#4ade80" />
      <rect x="8" y="6" width="2" height="2" fill="#4ade80" />
      <rect x="6" y="8" width="2" height="2" fill="#4ade80" />
      <rect x="4" y="10" width="2" height="2" fill="#4ade80" />
    </svg>
  );
}

// ─── PSN ───────────────────────────────────────────────────────
// Four PlayStation button glyphs in 2x2 grid:
//   triangle (top), circle (right), cross (bottom), square (left)
// Colors: triangle=green, circle=red, cross=blue, square=pink
export function PSNIcon({ size = 16, ...rest }: PlatformIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Triangle (top-center) — 3-pixel upward triangle */}
      <rect x="7" y="2" width="2" height="1" fill="#4ade80" />
      <rect x="6" y="3" width="4" height="1" fill="#4ade80" />
      <rect x="5" y="4" width="6" height="1" fill="#4ade80" />

      {/* Circle (right-center) — small pixel ring */}
      <rect x="11" y="6" width="2" height="1" fill="#f87171" />
      <rect x="10" y="7" width="1" height="2" fill="#f87171" />
      <rect x="13" y="7" width="1" height="2" fill="#f87171" />
      <rect x="11" y="9" width="2" height="1" fill="#f87171" />

      {/* Cross/X (bottom-center) — pixel X */}
      <rect x="6" y="11" width="1" height="1" fill="#7c5cff" />
      <rect x="7" y="12" width="2" height="1" fill="#7c5cff" />
      <rect x="9" y="11" width="1" height="1" fill="#7c5cff" />
      <rect x="6" y="13" width="1" height="1" fill="#7c5cff" />
      <rect x="9" y="13" width="1" height="1" fill="#7c5cff" />

      {/* Square (left-center) — small filled square outline */}
      <rect x="2" y="6" width="4" height="4" fill="#f472b6" />
      <rect x="3" y="7" width="2" height="2" fill="#1a1a24" />
    </svg>
  );
}

// ─── Switch ────────────────────────────────────────────────────
// Two Joy-Con rectangles (left=cyan, right=red) flanking a slim body
export function SwitchIcon({ size = 16, ...rest }: PlatformIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Left Joy-Con (cyan) */}
      <rect x="1" y="4" width="4" height="8" fill="#06b6d4" />
      {/* Left Joy-Con rounded corners (pixel-style cutoffs) */}
      <rect x="2" y="3" width="3" height="1" fill="#06b6d4" />
      <rect x="2" y="12" width="3" height="1" fill="#06b6d4" />
      {/* Left stick nub */}
      <rect x="2" y="5" width="2" height="2" fill="#fff" opacity="0.7" />

      {/* Center body */}
      <rect x="5" y="3" width="6" height="10" fill="#2a2a38" />
      {/* Center screen area */}
      <rect x="6" y="4" width="4" height="5" fill="#1a1a24" />
      {/* Center screen glow */}
      <rect x="6" y="5" width="4" height="1" fill="#7c5cff" opacity="0.5" />

      {/* Right Joy-Con (red) */}
      <rect x="11" y="4" width="4" height="8" fill="#ef4444" />
      {/* Right Joy-Con rounded corners */}
      <rect x="11" y="3" width="3" height="1" fill="#ef4444" />
      <rect x="11" y="12" width="3" height="1" fill="#ef4444" />
      {/* Right stick nub */}
      <rect x="12" y="9" width="2" height="2" fill="#fff" opacity="0.7" />
      {/* Right face buttons (2 small dots) */}
      <rect x="12" y="5" width="1" height="1" fill="#fff" opacity="0.8" />
      <rect x="14" y="5" width="1" height="1" fill="#fff" opacity="0.8" />
    </svg>
  );
}

export const PLATFORM_ICONS = {
  pc: PCIcon,
  steam: SteamIcon,
  xbox: XboxIcon,
  psn: PSNIcon,
  switch: SwitchIcon,
} as const;
