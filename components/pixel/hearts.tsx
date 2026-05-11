import { memo } from "react";
import type { SVGProps } from "react";

const HEART_RED = "#ef4444";
const HEART_OUTLINE = "#1a1a24";
const HEART_HIGHLIGHT = "#fca5a5";

interface HeartProps extends Omit<SVGProps<SVGSVGElement>, "viewBox"> {
  size?: number;
}

/**
 * Minecraft-style pixel heart, 16x16 native.
 * Half-heart is vertically split (left half full, right half empty).
 * Color: bright red fill, dark outline, single highlight pixel.
 */
export const HeartFull = memo(function HeartFull({ size = 16, ...rest }: HeartProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="none"
      {...rest}
    >
      {/* Outline (top notches) */}
      <rect x="2" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      {/* Outline (sides) */}
      <rect x="1" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="14" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="2" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="13" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      {/* Outline (bottom point) */}
      <rect x="3" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="11" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="5" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="10" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="6" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="7" y="14" width="2" height="1" fill={HEART_OUTLINE} />
      {/* Red fill */}
      {/* Lobe interior at row 3 (under top notches) */}
      <rect x="4" y="3" width="3" height="1" fill={HEART_RED} />
      <rect x="9" y="3" width="3" height="1" fill={HEART_RED} />
      <rect x="2" y="4" width="5" height="4" fill={HEART_RED} />
      <rect x="9" y="4" width="5" height="4" fill={HEART_RED} />
      <rect x="3" y="8" width="10" height="2" fill={HEART_RED} />
      <rect x="4" y="10" width="8" height="1" fill={HEART_RED} />
      <rect x="5" y="11" width="6" height="1" fill={HEART_RED} />
      <rect x="6" y="12" width="4" height="1" fill={HEART_RED} />
      <rect x="7" y="13" width="2" height="1" fill={HEART_RED} />
      {/* Highlight (small pixel sheen, top-left) */}
      <rect x="3" y="4" width="2" height="1" fill={HEART_HIGHLIGHT} />
      <rect x="3" y="5" width="1" height="1" fill={HEART_HIGHLIGHT} />
    </svg>
  );
});

export const HeartHalf = memo(function HeartHalf({ size = 16, ...rest }: HeartProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="none"
      {...rest}
    >
      {/* Outline (full — same as HeartFull) */}
      <rect x="2" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="1" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="14" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="2" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="13" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="3" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="11" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="5" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="10" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="6" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="7" y="14" width="2" height="1" fill={HEART_OUTLINE} />
      {/* Vertical split line down the middle */}
      <rect x="8" y="3" width="1" height="11" fill={HEART_OUTLINE} />
      {/* Red fill — LEFT HALF ONLY */}
      {/* Left lobe interior at row 3 (under top notch) */}
      <rect x="4" y="3" width="3" height="1" fill={HEART_RED} />
      <rect x="2" y="4" width="5" height="4" fill={HEART_RED} />
      <rect x="3" y="8" width="5" height="2" fill={HEART_RED} />
      <rect x="4" y="10" width="4" height="1" fill={HEART_RED} />
      <rect x="5" y="11" width="3" height="1" fill={HEART_RED} />
      <rect x="6" y="12" width="2" height="1" fill={HEART_RED} />
      <rect x="7" y="13" width="1" height="1" fill={HEART_RED} />
      {/* Highlight */}
      <rect x="3" y="4" width="2" height="1" fill={HEART_HIGHLIGHT} />
      <rect x="3" y="5" width="1" height="1" fill={HEART_HIGHLIGHT} />
    </svg>
  );
});

export const HeartEmpty = memo(function HeartEmpty({ size = 16, ...rest }: HeartProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="none"
      {...rest}
    >
      {/* Outline only, no fill — same outline as HeartFull */}
      <rect x="2" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="2" width="3" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="3" width="2" height="1" fill={HEART_OUTLINE} />
      <rect x="1" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="14" y="4" width="1" height="4" fill={HEART_OUTLINE} />
      <rect x="2" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="13" y="8" width="1" height="2" fill={HEART_OUTLINE} />
      <rect x="3" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="12" y="10" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="4" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="11" y="11" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="5" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="10" y="12" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="6" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="9" y="13" width="1" height="1" fill={HEART_OUTLINE} />
      <rect x="7" y="14" width="2" height="1" fill={HEART_OUTLINE} />
    </svg>
  );
});
