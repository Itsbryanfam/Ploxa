import type { SVGProps } from "react";

interface StatusIconProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  size?: number;
}

const COLORS = {
  backlog: "#9494a8",
  playing: "#7c5cff",
  completed: "#4ade80",
  dropped: "#f87171",
  on_hold: "#fbbf24",
  wishlist: "#ffb84a",
} as const;

export function BacklogIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Stack of 3 cartridges */}
      <rect x="3" y="3" width="10" height="2" fill={COLORS.backlog} />
      <rect x="2" y="4" width="12" height="1" fill="#1a1a24" />
      <rect x="3" y="6" width="10" height="2" fill={COLORS.backlog} />
      <rect x="2" y="7" width="12" height="1" fill="#1a1a24" />
      <rect x="3" y="9" width="10" height="2" fill={COLORS.backlog} />
      <rect x="2" y="10" width="12" height="1" fill="#1a1a24" />
      <rect x="2" y="12" width="12" height="1" fill="#1a1a24" />
    </svg>
  );
}

export function PlayingIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Controller body */}
      <rect x="2" y="6" width="12" height="6" fill={COLORS.playing} />
      <rect x="3" y="5" width="10" height="1" fill={COLORS.playing} />
      <rect x="3" y="12" width="10" height="1" fill={COLORS.playing} />
      {/* D-pad cross (left) */}
      <rect x="4" y="8" width="3" height="1" fill="#fff" />
      <rect x="5" y="7" width="1" height="3" fill="#fff" />
      {/* Buttons (right) */}
      <rect x="10" y="7" width="1" height="1" fill="#fff" />
      <rect x="12" y="7" width="1" height="1" fill="#fff" />
      <rect x="10" y="9" width="1" height="1" fill="#fff" />
      <rect x="12" y="9" width="1" height="1" fill="#fff" />
    </svg>
  );
}

export function CompletedIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Trophy cup */}
      <rect x="4" y="3" width="8" height="5" fill={COLORS.completed} />
      <rect x="3" y="4" width="1" height="2" fill={COLORS.completed} />
      <rect x="12" y="4" width="1" height="2" fill={COLORS.completed} />
      <rect x="5" y="8" width="6" height="1" fill={COLORS.completed} />
      {/* Stem */}
      <rect x="7" y="9" width="2" height="2" fill={COLORS.completed} />
      {/* Base */}
      <rect x="5" y="11" width="6" height="2" fill={COLORS.completed} />
    </svg>
  );
}

export function DroppedIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Cartridge top half */}
      <rect x="3" y="4" width="6" height="4" fill={COLORS.dropped} />
      {/* Cartridge bottom half (offset to suggest break) */}
      <rect x="7" y="9" width="6" height="4" fill={COLORS.dropped} />
      {/* Crack lines */}
      <rect x="9" y="6" width="1" height="1" fill="#1a1a24" />
      <rect x="6" y="9" width="1" height="1" fill="#1a1a24" />
    </svg>
  );
}

export function OnHoldIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* Pause bars in a circle */}
      <rect x="5" y="3" width="6" height="1" fill={COLORS.on_hold} />
      <rect x="3" y="5" width="1" height="6" fill={COLORS.on_hold} />
      <rect x="12" y="5" width="1" height="6" fill={COLORS.on_hold} />
      <rect x="5" y="12" width="6" height="1" fill={COLORS.on_hold} />
      <rect x="4" y="4" width="1" height="1" fill={COLORS.on_hold} />
      <rect x="11" y="4" width="1" height="1" fill={COLORS.on_hold} />
      <rect x="4" y="11" width="1" height="1" fill={COLORS.on_hold} />
      <rect x="11" y="11" width="1" height="1" fill={COLORS.on_hold} />
      {/* Two pause bars */}
      <rect x="6" y="6" width="1" height="4" fill={COLORS.on_hold} />
      <rect x="9" y="6" width="1" height="4" fill={COLORS.on_hold} />
    </svg>
  );
}

export function WishlistIcon({ size = 16, ...rest }: StatusIconProps) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" {...rest}>
      {/* 5-point pixel star */}
      <rect x="7" y="2" width="2" height="2" fill={COLORS.wishlist} />
      <rect x="6" y="4" width="4" height="2" fill={COLORS.wishlist} />
      <rect x="2" y="6" width="12" height="2" fill={COLORS.wishlist} />
      <rect x="3" y="8" width="10" height="2" fill={COLORS.wishlist} />
      <rect x="4" y="10" width="3" height="2" fill={COLORS.wishlist} />
      <rect x="9" y="10" width="3" height="2" fill={COLORS.wishlist} />
      <rect x="3" y="12" width="3" height="2" fill={COLORS.wishlist} />
      <rect x="10" y="12" width="3" height="2" fill={COLORS.wishlist} />
    </svg>
  );
}

// Lookup helper for dynamic rendering
export const STATUS_ICONS = {
  backlog: BacklogIcon,
  playing: PlayingIcon,
  completed: CompletedIcon,
  dropped: DroppedIcon,
  on_hold: OnHoldIcon,
  wishlist: WishlistIcon,
} as const;
